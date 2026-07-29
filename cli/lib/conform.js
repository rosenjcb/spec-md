import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatValue } from "./expr.js";
import { actionLabel, enumerateTraces, formatModelState, formatTrace, withDerived } from "./explore.js";
import { specLabel } from "./report.js";

/**
 * Conformance testing: does the observed implementation conform to the model?
 *
 * For each generated trace the runner puts the model and the implementation in
 * corresponding initial states, performs the same action on both, observes the
 * implementation, and compares it with the model's predicted state. Traces are
 * replayed shortest-first, so the first failure is the minimal counterexample.
 *
 * The bridge is an *adapter* module named by the model's `adapter:` key:
 *
 *   export default {
 *     async init(state) { return handle },              // both start here
 *     actions: { "AC-1": async (handle, args) => {} },  // by id or by name
 *     async observe(handle) { return { count: 1 } },    // model-shaped state
 *     async teardown(handle) {},                        // optional
 *   }
 */

const EPSILON = 1e-9;

/** Resolve and import a model's adapter module. */
export async function loadAdapter(specPath, model) {
  if (!model.adapter) {
    return { adapter: null, error: `${model.id} declares no \`adapter\` — nothing to conform against` };
  }
  const path = resolve(dirname(specPath), model.adapter);
  if (!existsSync(path)) {
    return { adapter: null, path, error: `adapter not found (spec-relative): ${model.adapter}` };
  }

  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch (e) {
    return { adapter: null, path, error: `adapter failed to load: ${e.message}` };
  }
  const adapter = mod.default ?? mod.adapter ?? mod;

  const missing = [];
  if (typeof adapter?.init !== "function") missing.push("init(state)");
  if (typeof adapter?.observe !== "function") missing.push("observe(handle)");
  if (!adapter?.actions || typeof adapter.actions !== "object") missing.push("actions");
  if (missing.length) {
    return { adapter: null, path, error: `adapter is missing ${missing.join(", ")}` };
  }

  const unhandled = model.actions
    .filter((action) => typeof handlerFor(adapter, action) !== "function")
    .map((action) => action.id);
  if (unhandled.length) {
    return { adapter: null, path, error: `adapter has no handler for ${unhandled.join(", ")}` };
  }

  return { adapter, path };
}

const handlerFor = (adapter, action) => adapter.actions[action.id] ?? adapter.actions[action.name];

/**
 * Replay generated traces against the adapter.
 * Returns a report whose `failure` is the minimal counterexample, or null.
 */
export async function runConformance(model, adapter, options = {}) {
  const traces = enumerateTraces(model, options);
  const observedKeys = new Set();
  let tracesRun = 0;
  let stepsRun = 0;
  let comparisons = 0;
  let failure = null;

  for (const trace of traces) {
    let handle;
    try {
      handle = await adapter.init({ ...trace.initial });
    } catch (e) {
      failure = { kind: "init", trace, message: e.message };
      break;
    }
    tracesRun++;

    try {
      const start = await observe(adapter, handle, observedKeys);
      const drift = compare(model, trace.initial, start);
      if (drift) {
        failure = { kind: "mismatch", trace, steps: [], ...drift };
        break;
      }
      comparisons++;

      for (let i = 0; i < trace.steps.length; i++) {
        const step = trace.steps[i];
        try {
          await handlerFor(adapter, step.action)(handle, { ...step.args });
        } catch (e) {
          failure = { kind: "error", trace, steps: trace.steps.slice(0, i + 1), step, message: e.message };
          break;
        }
        stepsRun++;
        const state = await observe(adapter, handle, observedKeys);
        const drift = compare(model, step.vars, state);
        comparisons++;
        if (drift) {
          failure = { kind: "mismatch", trace, steps: trace.steps.slice(0, i + 1), step, ...drift };
          break;
        }
      }
    } catch (e) {
      failure = { kind: "observe", trace, message: e.message };
    } finally {
      if (typeof adapter.teardown === "function") {
        try {
          await adapter.teardown(handle);
        } catch {
          // A failing teardown must not mask the conformance result.
        }
      }
    }
    if (failure) break;
  }

  const modelKeys = [...model.state.map((d) => d.name), ...model.derived.map((d) => d.name)];
  return {
    model,
    traces: traces.length,
    tracesRun,
    stepsRun,
    comparisons,
    failure,
    unobserved: modelKeys.filter((name) => !observedKeys.has(name)),
    extraKeys: [...observedKeys].filter((name) => !modelKeys.includes(name)),
  };
}

async function observe(adapter, handle, observedKeys) {
  const state = await adapter.observe(handle);
  if (state === null || typeof state !== "object") {
    throw new Error(`observe() must return an object of state values, got ${formatValue(state)}`);
  }
  for (const key of Object.keys(state)) observedKeys.add(key);
  return state;
}

/** Compare an observation against the model's prediction. Null when they agree. */
function compare(model, vars, observed) {
  const predicted = withDerived(model, vars);
  const differing = [];
  for (const [name, value] of Object.entries(observed)) {
    if (!Object.hasOwn(predicted, name)) continue; // not part of the model's abstraction
    if (!equalValues(predicted[name], value)) differing.push(name);
  }
  if (!differing.length) return null;
  return {
    differing,
    expected: Object.fromEntries(differing.map((name) => [name, predicted[name]])),
    observed: Object.fromEntries(differing.map((name) => [name, observed[name]])),
  };
}

/** "FR-1, FR-2 and AC-1" — how a report names several ids in prose. */
function list(ids) {
  if (ids.length < 2) return ids[0] ?? "";
  return `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
}

const equalValues = (a, b) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= EPSILON : a === b;

/**
 * Render a conformance failure as the report a reviewer needs: the minimal
 * counterexample, the contract it violates, and the two ways out.
 */
export function formatConformanceFailure({ spec, model, failure }) {
  const lines = [];
  const push = (line = "") => lines.push(line);
  const step = failure.step;
  const action = step?.action;
  const differing = failure.differing ?? [];
  const { assigners, constraints } = definingElements(model, differing);
  // Requirements come from whatever *defines* the wrong value, which is often
  // not the action that tripped the mismatch — placing an order is merely where
  // a bad running total becomes observable.
  const frIds = new Set([
    ...(action?.requirements ?? []),
    ...assigners.flatMap((e) => e.requirements),
  ]);
  if (!frIds.size) for (const a of model.actions) for (const id of a.requirements) frIds.add(id);
  const frRows = spec.frs.filter((fr) => frIds.has(fr.id));
  const owners = (assigners.length ? assigners : [action]).filter(Boolean).map((e) => e.id);

  push(failure.kind === "mismatch" ? "Behavioral conformance failed" : "Conformance run failed");
  push();
  push(`Spec: ${specLabel(spec)}`);
  push(`Model: ${model.id}${model.name && model.name !== model.id ? ` ${model.name}` : ""}`);
  push();
  push("Minimal counterexample:");
  push(`  Initial state: ${formatModelState(model, failure.trace.initial)}`);
  const steps = failure.steps ?? failure.trace.steps;
  if (steps.length === 1 && action) {
    push(`  Action: ${actionLabel(action, step.args)}`);
  } else if (steps.length) {
    push("  Trace:");
    for (const line of formatTrace(model, steps, "    ")) push(line);
  }
  push();

  if (failure.kind === "mismatch") {
    push("Expected:");
    for (const [name, value] of Object.entries(failure.expected)) push(`  ${name} = ${formatValue(value)}`);
    push();
    push("Observed:");
    for (const [name, value] of Object.entries(failure.observed)) push(`  ${name} = ${formatValue(value)}`);
  } else {
    push(`${failure.kind === "error" ? "Error from the implementation" : "Error"}:`);
    push(`  ${failure.message}`);
  }
  push();

  if (frRows.length || action) {
    push("Relevant contract:");
    for (const fr of frRows) push(`  ${fr.id}: ${fr.text}`);
    if (action) for (const line of contractLines(action, differing, true)) push(`  ${line}`);
    for (const element of assigners) {
      if (element === action) continue;
      for (const line of contractLines(element, differing, false)) push(`  ${line}`);
    }
    for (const element of constraints) for (const line of contractLines(element)) push(`  ${line}`);
    push();
  }

  push("Possible resolutions:");
  if (failure.kind === "mismatch") {
    push(`  - Restore implementation behavior so it still follows ${list(owners) || model.id}`);
    push(
      `  - Update ${list([...frRows.map((fr) => fr.id), ...owners])} ` +
        `to define the new behavior, then add the QA Test Case that pins the boundary`,
    );
  } else {
    push(`  - Fix the adapter or the implementation so ${action ? action.id : "the run"} completes`);
    push(`  - Add a \`requires:\` guard to ${action ? action.id : "the action"} if the model should not offer it here`);
  }

  return lines;
}

/**
 * Split the model by how it relates to the variables that came out wrong:
 * `assigners` are the actions that set them (who owns the value), `constraints`
 * are the invariants and properties that say something about them.
 */
function definingElements(model, differing) {
  if (!differing.length) return { assigners: [], constraints: [] };
  const names = new Set(differing);
  const assigners = model.actions.filter((action) =>
    action.updates.some((update) => names.has(update.target)),
  );
  const constraints = [...model.invariants, ...model.properties]
    .filter((element) => {
      const source = element.check?.src ?? element.claim?.src ?? "";
      const words = new Set(source.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []);
      return [...names].some((name) => words.has(name));
    })
    // A wall of claims helps nobody; the closest few carry the point.
    .slice(0, 3);
  return { assigners, constraints };
}

/**
 * How one model element reads in a contract block. For an action, `only`
 * narrows the updates to the variables that actually differed, and `guard`
 * includes its precondition.
 */
function contractLines(element, only = [], guard = true) {
  if (!element.updates) {
    const claim = element.check?.src ?? element.claim?.src;
    return claim ? [`${element.id}: ${claim}`] : [];
  }
  const names = new Set(only);
  const updates = element.updates.filter((u) => !names.size || names.has(u.target));
  return [
    guard && element.guard ? `${element.id} requires: ${element.guard.src}` : null,
    ...(updates.length ? updates : element.updates).map(
      (u) => `${element.id}: ${u.target}' = ${u.expr.src}`,
    ),
  ].filter(Boolean);
}
