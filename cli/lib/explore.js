import { evalExpr, formatValue, formatState } from "./expr.js";
import { inDomain } from "./model.js";
import { specLabel } from "./report.js";

/**
 * Behavioral exploration: walk a model's state/action space within configured
 * bounds and check that every invariant (`INV-N`) and behavioral property
 * (`BP-N`) holds along the way.
 *
 * Tests protect examples; a model protects behavior. Exploration is what makes
 * that true — it visits state/action combinations nobody thought to name, and
 * because the search is breadth-first the first counterexample it finds is also
 * the shortest one.
 *
 * Declared domains (`count: integer in 0..100`) bound the *search*: they pick
 * the initial states and arguments to try, and they mark the frontier past
 * which the walk stops expanding. They are not constraints on the model — a
 * transition may leave the domain, and that state is still checked against
 * every invariant and property. Only invariants say what must be true.
 */

export const DEFAULTS = {
  depth: 4,
  maxStates: 4000,
  maxInits: 8,
  maxArgs: 3,
  maxTraces: 200,
  maxArgTuples: 64,
};

/** Add every derived variable to a plain state object. */
export function withDerived(model, vars) {
  if (!model.derived.length) return vars;
  const scope = { ...vars };
  for (const derived of model.derived) {
    scope[derived.name] = evalExpr(derived.expr.ast, { vars: scope });
  }
  return scope;
}

/**
 * The scope an expression is evaluated in: the model's enum symbols, the state
 * (with derived variables), and the current action's arguments — in that order,
 * so a declared name always beats a symbol of the same spelling.
 */
export function scopeFor(model, vars, args = {}) {
  return { ...model.constants, ...withDerived(model, vars), ...args };
}

const stateKey = (model, vars) => model.state.map((decl) => JSON.stringify(vars[decl.name])).join(" ");

/** Values a generated initial state or argument may take for one declaration. */
export function boundaryValues(decl) {
  const { domain, type } = decl;
  if (domain?.kind === "enum") return [...domain.values];
  if (domain?.kind === "range") {
    const { min, max } = domain;
    const mid = type === "integer" ? Math.floor((min + max) / 2) : (min + max) / 2;
    return dedupe([min, max, mid]);
  }
  if (type === "boolean") return [false, true];
  if (type === "string") return [""];
  return [0, 1, -1];
}

const dedupe = (values) => [...new Set(values)];

/** Is every state variable still inside its declared domain? */
export function withinDomains(model, vars) {
  return model.state.every((decl) => inDomain(vars[decl.name], decl.domain));
}

/**
 * Generated initial states: the declared one first, then domain boundaries
 * (one variable moved at a time). States that break an invariant are dropped —
 * invariants define which states are valid to start from.
 */
export function initialStates(model, { maxInits = DEFAULTS.maxInits } = {}) {
  const declared = {};
  for (const decl of model.state) declared[decl.name] = decl.initial;

  const states = [declared];
  const seen = new Set([stateKey(model, declared)]);
  for (const decl of model.state) {
    if (!decl.domain) continue;
    for (const value of boundaryValues(decl)) {
      if (states.length >= maxInits) return states;
      const candidate = { ...declared, [decl.name]: value };
      const key = stateKey(model, candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      if (invariantFailures(model, candidate).length) continue;
      states.push(candidate);
    }
  }
  return states;
}

/** Argument tuples to try for an action's parameters. */
export function enumerateArgs(params, maxArgs = DEFAULTS.maxArgs, maxTuples = DEFAULTS.maxArgTuples) {
  if (!params.length) return [{}];
  let tuples = [{}];
  for (const param of params) {
    const values = boundaryValues(param).slice(0, Math.max(1, maxArgs));
    const next = [];
    for (const tuple of tuples) {
      for (const value of values) {
        if (next.length >= maxTuples) break;
        next.push({ ...tuple, [param.name]: value });
      }
    }
    tuples = next;
  }
  return tuples;
}

/** Is an action's guard satisfied in this state? Guard errors count as disabled. */
export function isEnabled(model, action, vars, args) {
  if (!action.guard) return true;
  try {
    return evalExpr(action.guard.ast, { vars: scopeFor(model, vars, args) }) === true;
  } catch {
    return false;
  }
}

/**
 * Every (action, arguments) pair enabled in this state, plus the guards that
 * could not be evaluated (a model error worth reporting, not a silent skip).
 */
export function enabledSteps(model, vars, { maxArgs = DEFAULTS.maxArgs } = {}) {
  const scope = scopeFor(model, vars);
  const steps = [];
  const errors = [];
  for (const action of model.actions) {
    for (const args of enumerateArgs(action.params, maxArgs)) {
      if (!action.guard) {
        steps.push({ action, args });
        continue;
      }
      try {
        if (evalExpr(action.guard.ast, { vars: { ...scope, ...args } }) === true) {
          steps.push({ action, args });
        }
      } catch (e) {
        errors.push({ action, args, message: `guard of ${action.id}: ${e.message}` });
      }
    }
  }
  return { steps, errors };
}

/**
 * Apply an action. Every right-hand side is evaluated against the pre-state, so
 * updates happen simultaneously (`a' = b` / `b' = a` swaps).
 */
export function applyAction(model, action, vars, args = {}) {
  const scope = scopeFor(model, vars, args);
  const next = { ...vars };
  for (const update of action.updates) {
    const value = evalExpr(update.expr.ast, { vars: scope });
    const decl = model.state.find((s) => s.name === update.target);
    if (decl && decl.type === "integer" && typeof value === "number" && !Number.isInteger(value)) {
      throw new Error(
        `${action.id} assigns ${formatValue(value)} to integer variable "${update.target}"`,
      );
    }
    if (decl && decl.type === "boolean" && typeof value !== "boolean") {
      throw new Error(`${action.id} assigns ${formatValue(value)} to boolean variable "${update.target}"`);
    }
    if (decl && (decl.type === "integer" || decl.type === "number") && typeof value !== "number") {
      throw new Error(`${action.id} assigns ${formatValue(value)} to numeric variable "${update.target}"`);
    }
    next[update.target] = value;
  }
  return next;
}

/** Invariants that do not hold in this state. */
export function invariantFailures(model, vars) {
  if (!model.invariants.length) return [];
  let scope;
  try {
    scope = scopeFor(model, vars);
  } catch (e) {
    return [{ invariant: model.invariants[0], error: `derived state: ${e.message}` }];
  }
  const failures = [];
  for (const invariant of model.invariants) {
    if (!invariant.check) continue;
    try {
      if (evalExpr(invariant.check.ast, { vars: scope }) !== true) failures.push({ invariant });
    } catch (e) {
      failures.push({ invariant, error: e.message });
    }
  }
  return failures;
}

const EPSILON = 1e-9;
const sameValue = (a, b) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= EPSILON : a === b;

/**
 * Explore the model. Returns a report; `violations` is ordered shortest-trace
 * first, so `violations[0]` is the minimal counterexample.
 */
export function exploreModel(model, options = {}) {
  const {
    depth = DEFAULTS.depth,
    maxStates = DEFAULTS.maxStates,
    maxInits = DEFAULTS.maxInits,
    maxArgs = DEFAULTS.maxArgs,
  } = options;

  const violations = [];
  const propertyChecks = new Map(model.properties.map((p) => [p.id, 0]));
  const inits = initialStates(model, { maxInits });
  const seen = new Set();
  const queue = [];
  let transitions = 0;
  let visited = 0;
  let bounded = false;
  let outsideDomain = 0;

  for (const vars of inits) {
    for (const failure of invariantFailures(model, vars)) {
      violations.push({
        kind: "invariant",
        element: failure.invariant,
        error: failure.error,
        initial: vars,
        trace: [],
      });
    }
    const key = stateKey(model, vars);
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ vars, initial: vars, trace: [], expandable: true });
  }

  while (queue.length) {
    if (visited >= maxStates) {
      bounded = true;
      break;
    }
    const node = queue.shift();
    visited++;

    for (const property of model.properties) {
      if (property.claim?.kind === "always") {
        checkAlways(model, property, node, violations, propertyChecks);
      } else if (property.claim?.kind === "preserves") {
        checkPreserves(model, property, node, violations, propertyChecks, maxArgs);
      }
    }

    // A state past the declared domains is checked, but not expanded.
    if (!node.expandable || node.trace.length >= depth) continue;

    const { steps, errors } = enabledSteps(model, node.vars, { maxArgs });
    for (const error of errors) {
      violations.push({
        kind: "error",
        element: error.action,
        message: error.message,
        initial: node.initial,
        trace: node.trace,
      });
    }
    for (const { action, args } of steps) {
      let next;
      try {
        next = applyAction(model, action, node.vars, args);
      } catch (e) {
        violations.push({
          kind: "error",
          element: action,
          message: e.message,
          initial: node.initial,
          trace: node.trace,
        });
        continue;
      }
      transitions++;
      const trace = [...node.trace, { action, args, vars: next }];

      for (const failure of invariantFailures(model, next)) {
        violations.push({
          kind: "invariant",
          element: failure.invariant,
          error: failure.error,
          initial: node.initial,
          trace,
        });
      }
      for (const property of model.properties) {
        if (property.claim?.kind !== "after" || property.claim.actions[0] !== action.id) continue;
        propertyChecks.set(property.id, propertyChecks.get(property.id) + 1);
        try {
          const holds = evalExpr(property.claim.expr.ast, {
            vars: scopeFor(model, next, args),
            pre: withDerived(model, node.vars),
          });
          if (holds !== true) {
            violations.push({ kind: "property", element: property, initial: node.initial, trace });
          }
        } catch (e) {
          violations.push({
            kind: "property",
            element: property,
            error: e.message,
            initial: node.initial,
            trace,
          });
        }
      }

      const key = stateKey(model, next);
      if (seen.has(key)) continue;
      seen.add(key);
      const expandable = withinDomains(model, next);
      if (!expandable) outsideDomain++;
      queue.push({ vars: next, initial: node.initial, trace, expandable });
    }
  }

  const unexercised = model.properties.filter(
    (p) => p.claim && propertyChecks.get(p.id) === 0,
  );
  // Breadth-first order is nearly minimal already, but a `preserves` claim runs
  // a whole sequence from the state it is checked in, so sort to be certain
  // violations[0] is the shortest counterexample.
  violations.sort((a, b) => a.trace.length - b.trace.length);

  return {
    model,
    depth,
    initialStates: inits,
    statesVisited: visited,
    statesSeen: seen.size,
    transitions,
    violations,
    propertyChecks,
    unexercised,
    outsideDomain,
    bounded,
  };
}

function checkAlways(model, property, node, violations, propertyChecks) {
  propertyChecks.set(property.id, propertyChecks.get(property.id) + 1);
  try {
    const holds = evalExpr(property.claim.expr.ast, { vars: scopeFor(model, node.vars) });
    if (holds !== true) {
      violations.push({ kind: "property", element: property, initial: node.initial, trace: node.trace });
    }
  } catch (e) {
    violations.push({
      kind: "property",
      element: property,
      error: e.message,
      initial: node.initial,
      trace: node.trace,
    });
  }
}

/**
 * `AC-1 then AC-2 preserves count` — run the sequence from this state and
 * compare the expression before and after. Parameters shared by name across the
 * sequence are bound once, so `AddItem(qty) then RemoveItem(qty)` lines up.
 */
function checkPreserves(model, property, node, violations, propertyChecks, maxArgs) {
  const byId = new Map(model.actions.map((a) => [a.id, a]));
  const sequence = property.claim.actions.map((id) => byId.get(id));
  if (sequence.some((a) => !a)) return;

  const shared = new Map();
  for (const action of sequence) {
    for (const param of action.params) if (!shared.has(param.name)) shared.set(param.name, param);
  }

  for (const binding of enumerateArgs([...shared.values()], maxArgs)) {
    let vars = node.vars;
    const steps = [];
    let ran = true;
    for (const action of sequence) {
      const args = {};
      for (const param of action.params) args[param.name] = binding[param.name];
      if (!isEnabled(model, action, vars, args)) {
        ran = false;
        break;
      }
      try {
        vars = applyAction(model, action, vars, args);
      } catch {
        ran = false;
        break;
      }
      steps.push({ action, args, vars });
    }
    if (!ran) continue;

    propertyChecks.set(property.id, propertyChecks.get(property.id) + 1);
    try {
      const before = evalExpr(property.claim.expr.ast, { vars: scopeFor(model, node.vars) });
      const after = evalExpr(property.claim.expr.ast, { vars: scopeFor(model, vars) });
      if (!sameValue(before, after)) {
        violations.push({
          kind: "property",
          element: property,
          initial: node.initial,
          trace: [...node.trace, ...steps],
          detail:
            `${property.claim.expr.src} was ${formatValue(before)} before the sequence ` +
            `and ${formatValue(after)} after`,
        });
      }
    } catch (e) {
      violations.push({
        kind: "property",
        element: property,
        error: e.message,
        initial: node.initial,
        trace: [...node.trace, ...steps],
      });
    }
  }
}

/**
 * Distinct action sequences to replay against an implementation, shortest
 * first, so the first conformance failure is the minimal counterexample.
 */
export function enumerateTraces(model, options = {}) {
  const {
    depth = 3,
    maxTraces = DEFAULTS.maxTraces,
    maxInits = DEFAULTS.maxInits,
    maxArgs = DEFAULTS.maxArgs,
  } = options;

  const traces = [];
  const queue = initialStates(model, { maxInits }).map((vars) => ({
    initial: vars,
    vars,
    steps: [],
    expandable: true,
  }));

  while (queue.length && traces.length < maxTraces) {
    const node = queue.shift();
    if (node.steps.length) traces.push({ initial: node.initial, steps: node.steps });
    if (!node.expandable || node.steps.length >= depth) continue;
    for (const { action, args } of enabledSteps(model, node.vars, { maxArgs }).steps) {
      let next;
      try {
        next = applyAction(model, action, node.vars, args);
      } catch {
        continue;
      }
      queue.push({
        initial: node.initial,
        vars: next,
        steps: [...node.steps, { action, args, vars: next }],
        expandable: withinDomains(model, next),
      });
    }
  }
  return traces;
}

/** `AC-3 SetCount(n = 5)` — how a step is named in a report. */
export function actionLabel(action, args = {}) {
  const named = action.name && action.name !== action.id ? ` ${action.name}` : "";
  const params = action.params.map((p) => `${p.name} = ${formatValue(args[p.name])}`).join(", ");
  return `${action.id}${named}${params ? `(${params})` : ""}`;
}

/** Render a trace as numbered steps with the state each one produces. */
export function formatTrace(model, steps, indent = "    ") {
  const names = model.state.map((decl) => decl.name);
  return steps.map(
    (step, i) => `${indent}${i + 1}. ${actionLabel(step.action, step.args)} → ${formatState(step.vars, names)}`,
  );
}

/**
 * Render a model violation: the minimal counterexample, the contract it
 * breaks, and the decision it forces. The mirror image of a conformance
 * failure — except here the model contradicts itself, before any
 * implementation is involved.
 */
export function formatViolation(spec, model, violation) {
  const lines = [];
  const element = violation.element;
  const claim = element.check?.src ?? element.claim?.src ?? null;
  const label = { invariant: "Invariant", property: "Property", error: "Action" }[violation.kind];

  lines.push(
    {
      invariant: "Invariant violated",
      property: "Behavioral property violated",
      error: "Model could not be evaluated",
    }[violation.kind],
  );
  lines.push("");
  lines.push(`Spec: ${specLabel(spec)}`);
  lines.push(`Model: ${model.id}${model.name && model.name !== model.id ? ` ${model.name}` : ""}`);
  lines.push(
    `${label}: ${element.id}` +
      `${element.name && element.name !== element.id ? ` ${element.name}` : ""}` +
      `${claim ? ` — ${claim}` : ""}`,
  );
  lines.push("");
  lines.push("Minimal counterexample:");
  lines.push(`  Initial state: ${formatModelState(model, violation.initial)}`);
  if (violation.trace.length === 1) {
    const step = violation.trace[0];
    lines.push(`  Action: ${actionLabel(step.action, step.args)}`);
    lines.push(`  Final state: ${formatModelState(model, step.vars)}`);
  } else if (violation.trace.length) {
    lines.push("  Trace:");
    lines.push(...formatTrace(model, violation.trace, "    "));
  }
  lines.push("");

  const detail = violation.detail || violation.error || violation.message;
  if (detail) {
    lines.push("Observed:");
    lines.push(`  ${detail}`);
    lines.push("");
  }

  const frRows = spec.frs.filter((fr) => element.requirements?.includes(fr.id));
  if (frRows.length) {
    lines.push("Relevant contract:");
    for (const fr of frRows) lines.push(`  ${fr.id}: ${fr.text}`);
    lines.push("");
  }

  lines.push("Possible resolutions:");
  lines.push(`  - Fix the transition model so ${element.id} holds within these bounds`);
  lines.push(`  - Update ${element.id} (and the requirement it cites) if the claim is no longer intended`);
  return lines;
}

/** Render a state the way counterexamples quote it. */
export function formatModelState(model, vars) {
  return formatState(withDerived(model, vars), [
    ...model.state.map((d) => d.name),
    ...model.derived.map((d) => d.name),
  ]);
}
