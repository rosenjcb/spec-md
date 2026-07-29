import { compileExpr, evalExpr, freeVars, ExprError } from "./expr.js";

/**
 * Parser for the behavioral model layer of a *.spec.md document.
 *
 * A model lives in a fenced ```spec-model block inside the spec's
 * `### Behavioral Model` section. It declares state, actions (`AC-N`),
 * invariants (`INV-N`), and behavioral properties (`BP-N`) — the executable
 * contract the implementation is checked against. The full language reference
 * is MODELS.md; this module only turns the text into a structure and reports
 * what it cannot make sense of.
 */

export const MODEL_FENCE_INFO = "spec-model";

export const MODEL_ID_PATTERNS = {
  mod: /^MOD-\d+$/,
  ac: /^AC-\d+$/,
  inv: /^INV-\d+$/,
  bp: /^BP-\d+$/,
};

export const STATE_TYPES = new Set(["integer", "number", "boolean", "string"]);

const FENCE_OPEN_RE = new RegExp(`^\\s*\`\`\`\\s*${MODEL_FENCE_INFO}\\s*$`);
const FENCE_CLOSE_RE = /^\s*```\s*$/;

const DECL_RE = /^(AC|INV|BP)-(\d+)(?:\s+([^:(]*?))?\s*(?:\(([^)]*)\))?\s*:\s*$/;
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/;
const UPDATE_RE = /^([A-Za-z_][A-Za-z0-9_]*)'\s*=\s*(.+)$/;
const MODEL_HEADER_RE = /^(MOD-\d+)(?:\s+(.*))?$/;
const RANGE_RE = /^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/;

const AFTER_RE = /^after\s+(AC-\d+)\s*,\s*(.+)$/i;
const PRESERVES_RE = /^(AC-\d+(?:\s+then\s+AC-\d+)*)\s+preserves\s+(.+)$/i;
const ALWAYS_RE = /^always\s+(.+)$/i;

const FR_REF_RE = /FR-\d+/g;

/** Drop a trailing `# comment`, ignoring `#` inside string literals. */
export function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#") return line.slice(0, i);
  }
  return line;
}

/** Split on commas that are not nested inside brackets or quotes. */
function splitTopLevel(text, separator = ",") {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** Index of the first top-level `=` that is not part of a comparison operator. */
function findAssignment(text) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch !== "=" || depth !== 0) continue;
    const before = text[i - 1];
    if (text[i + 1] === "=" || (before !== undefined && "<>!=".includes(before))) continue;
    return i;
  }
  return -1;
}

/** Locate every ```spec-model block in a document. `fromLine` skips frontmatter. */
export function findModelBlocks(text, fromLine = 0) {
  const lines = text.split("\n");
  const blocks = [];
  for (let i = fromLine; i < lines.length; i++) {
    if (!FENCE_OPEN_RE.test(lines[i])) continue;
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !FENCE_CLOSE_RE.test(lines[j]); j++) body.push(lines[j]);
    blocks.push({ src: body.join("\n"), startLine: i + 2 }); // 1-indexed first body line
    i = j;
  }
  return blocks;
}

/**
 * Read a `name: type [in domain] [= default]` declaration.
 * Returns { decl, problems }; `decl` is null when the line is unusable.
 */
function parseVarDecl(text, line) {
  const problems = [];
  const colon = text.indexOf(":");
  if (colon === -1) {
    return {
      decl: null,
      problems: [{ level: "error", msg: `Expected "name: type" in state declaration, found "${text}"`, line }],
    };
  }
  const name = text.slice(0, colon).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return {
      decl: null,
      problems: [{ level: "error", msg: `Invalid state variable name "${name}"`, line }],
    };
  }

  const rest = text.slice(colon + 1).trim();
  const eq = findAssignment(rest);
  const typePart = (eq === -1 ? rest : rest.slice(0, eq)).trim();
  const defaultPart = eq === -1 ? null : rest.slice(eq + 1).trim();

  const typeMatch = /^([A-Za-z]+)(?:\s+in\s+(.+))?$/.exec(typePart);
  if (!typeMatch) {
    return {
      decl: null,
      problems: [{ level: "error", msg: `Cannot read the type of "${name}" from "${typePart}"`, line }],
    };
  }
  const type = typeMatch[1];
  if (!STATE_TYPES.has(type)) {
    return {
      decl: null,
      problems: [
        {
          level: "error",
          msg: `Unknown type "${type}" for "${name}" (expected ${[...STATE_TYPES].join(", ")})`,
          line,
        },
      ],
    };
  }

  let domain = null;
  if (typeMatch[2]) {
    const parsed = parseDomain(typeMatch[2].trim(), type, name, line);
    problems.push(...parsed.problems);
    domain = parsed.domain;
  }

  let initial;
  if (defaultPart !== null) {
    const parsed = readLiteral(defaultPart, type);
    if (parsed.error) {
      problems.push({ level: "error", msg: `Default for "${name}": ${parsed.error}`, line });
      initial = defaultFor(type, domain);
    } else {
      initial = parsed.value;
      if (domain && !inDomain(initial, domain)) {
        problems.push({
          level: "error",
          msg: `Default ${defaultPart} for "${name}" is outside its declared domain`,
          line,
        });
      }
    }
  } else {
    initial = defaultFor(type, domain);
  }

  return { decl: { name, type, domain, initial, line, src: text }, problems };
}

function parseDomain(text, type, name, line) {
  const problems = [];
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) {
      problems.push({ level: "error", msg: `Unterminated enum domain for "${name}"`, line });
      return { domain: null, problems };
    }
    const values = [];
    for (const raw of splitTopLevel(text.slice(1, -1))) {
      const parsed = readLiteral(raw, type);
      if (parsed.error) {
        problems.push({ level: "error", msg: `Enum value ${raw} for "${name}": ${parsed.error}`, line });
        continue;
      }
      values.push(parsed.value);
    }
    if (!values.length) {
      problems.push({ level: "error", msg: `Enum domain for "${name}" is empty`, line });
      return { domain: null, problems };
    }
    return { domain: { kind: "enum", values }, problems };
  }

  const range = RANGE_RE.exec(text);
  if (!range) {
    problems.push({
      level: "error",
      msg: `Cannot read the domain of "${name}" from "${text}" (expected "lo..hi" or "[a, b, c]")`,
      line,
    });
    return { domain: null, problems };
  }
  if (type !== "integer" && type !== "number") {
    problems.push({ level: "error", msg: `A numeric range domain needs a numeric type ("${name}" is ${type})`, line });
    return { domain: null, problems };
  }
  const min = Number(range[1]);
  const max = Number(range[2]);
  if (min > max) {
    problems.push({ level: "error", msg: `Domain of "${name}" is inverted (${min}..${max})`, line });
    return { domain: null, problems };
  }
  return { domain: { kind: "range", min, max }, problems };
}

/** Read a literal in the declared type. Bare words are strings for `string`. */
function readLiteral(text, type) {
  const trimmed = text.trim();
  if (type === "string") {
    if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
      return { value: trimmed.slice(1, -1) };
    }
    if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) return { value: trimmed };
    return { error: `expected a string, found ${trimmed}` };
  }
  let value;
  try {
    value = evalExpr(compileExpr(trimmed).ast, { vars: {} });
  } catch (e) {
    return { error: e.message };
  }
  if (type === "boolean" && typeof value !== "boolean") {
    return { error: `expected a boolean, found ${trimmed}` };
  }
  if ((type === "integer" || type === "number") && typeof value !== "number") {
    return { error: `expected a number, found ${trimmed}` };
  }
  if (type === "integer" && !Number.isInteger(value)) {
    return { error: `expected an integer, found ${trimmed}` };
  }
  return { value };
}

function defaultFor(type, domain) {
  if (domain?.kind === "range") return domain.min;
  if (domain?.kind === "enum") return domain.values[0];
  if (type === "boolean") return false;
  if (type === "string") return "";
  return 0;
}

export function inDomain(value, domain) {
  if (!domain) return true;
  if (domain.kind === "range") return value >= domain.min && value <= domain.max;
  return domain.values.includes(value);
}

function parseParams(text, line) {
  const problems = [];
  const params = [];
  for (const part of splitTopLevel(text)) {
    const { decl, problems: declProblems } = parseVarDecl(part, line);
    problems.push(...declProblems);
    if (decl) params.push(decl);
  }
  return { params, problems };
}

/** Parse a `check:` claim on a BP row into a structured claim. */
function parseClaim(text, line) {
  const after = AFTER_RE.exec(text);
  if (after) {
    return { claim: { kind: "after", actions: [after[1]], expr: after[2].trim(), src: text }, problems: [] };
  }
  const preserves = PRESERVES_RE.exec(text);
  if (preserves) {
    const actions = preserves[1].split(/\s+then\s+/i).map((s) => s.trim());
    return { claim: { kind: "preserves", actions, expr: preserves[2].trim(), src: text }, problems: [] };
  }
  const always = ALWAYS_RE.exec(text);
  if (always) {
    return { claim: { kind: "always", actions: [], expr: always[1].trim(), src: text }, problems: [] };
  }
  return {
    claim: null,
    problems: [
      {
        level: "error",
        msg:
          `Cannot read the property claim "${text}". Use "after AC-N, <expr>", ` +
          `"AC-N then AC-M preserves <expr>", or "always <expr>"`,
        line,
      },
    ],
  };
}

const refs = (text) => [...String(text).matchAll(FR_REF_RE)].map((m) => m[0]);

/** Parse one ```spec-model block. `index` seeds the default MOD id. */
export function parseModelBlock(src, { startLine = 1, index = 0 } = {}) {
  const problems = [];
  const err = (msg, line) => problems.push({ level: "error", msg, line });
  const warn = (msg, line) => problems.push({ level: "warn", msg, line });

  const model = {
    id: `MOD-${index + 1}`,
    valid: true,
    name: "",
    adapter: null,
    state: [],
    derived: [],
    actions: [],
    invariants: [],
    properties: [],
    line: startLine,
  };

  const lines = src.split("\n");
  let section = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]);
    if (!raw.trim()) continue;
    const line = startLine + i;
    const text = raw.trim();

    if (/^\s/.test(raw)) {
      if (!section) {
        err(`Indented line does not belong to a declaration: "${text}"`, line);
        continue;
      }
      problems.push(...parseBodyLine(section, text, line, model));
      continue;
    }

    section = null;
    if (text === "state:") {
      section = { kind: "state" };
      continue;
    }
    if (text === "derived:") {
      section = { kind: "derived" };
      continue;
    }

    const decl = DECL_RE.exec(text);
    if (decl) {
      const [, prefix, digits, rawName, rawParams] = decl;
      const id = `${prefix}-${digits}`;
      const name = (rawName || "").trim();
      if (prefix !== "AC" && rawParams !== undefined) {
        err(`${id} cannot take parameters (only actions do)`, line);
      }
      let params = [];
      if (prefix === "AC" && rawParams !== undefined) {
        const parsed = parseParams(rawParams, line);
        problems.push(...parsed.problems);
        params = parsed.params;
      }
      if (prefix === "AC") {
        const action = { id, valid: true, name, params, guard: null, updates: [], requirements: [], line };
        model.actions.push(action);
        section = { kind: "AC", target: action };
      } else if (prefix === "INV") {
        const invariant = { id, valid: true, name, check: null, requirements: [], line };
        model.invariants.push(invariant);
        section = { kind: "INV", target: invariant };
      } else {
        const property = { id, valid: true, name, claim: null, requirements: [], line };
        model.properties.push(property);
        section = { kind: "BP", target: property };
      }
      continue;
    }

    const kv = KEY_RE.exec(text);
    if (!kv) {
      err(`Cannot read model declaration "${text}"`, line);
      continue;
    }
    const [, key, value] = kv;
    if (key === "model") {
      const header = MODEL_HEADER_RE.exec(value.trim());
      if (!header) {
        err(`\`model\` must be "MOD-<number> [name]" (found "${value.trim()}")`, line);
        continue;
      }
      model.id = header[1];
      model.name = (header[2] || "").trim();
      model.line = line;
      continue;
    }
    if (key === "adapter") {
      model.adapter = value.trim();
      continue;
    }
    warn(`Unknown model key \`${key}\` — expected \`model\`, \`adapter\`, \`state\`, or \`derived\``, line);
  }

  if (!model.name) model.name = model.id;
  model.constants = enumConstants(model);
  return { model, problems };
}

/**
 * Values of every string enum domain in the model form a symbol namespace, so
 * `status = created` reads as intended instead of as an unknown variable. A
 * state variable of the same name always wins.
 */
function enumConstants(model) {
  const constants = {};
  const declarations = [model.state, model.actions.flatMap((a) => a.params)].flat();
  for (const decl of declarations) {
    if (decl.domain?.kind !== "enum") continue;
    for (const value of decl.domain.values) {
      if (typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) constants[value] = value;
    }
  }
  return constants;
}

function parseBodyLine(section, text, line, model) {
  const problems = [];
  const err = (msg) => problems.push({ level: "error", msg, line });

  if (section.kind === "state" || section.kind === "derived") {
    if (section.kind === "state") {
      const { decl, problems: declProblems } = parseVarDecl(text, line);
      problems.push(...declProblems);
      if (decl) model.state.push(decl);
      return problems;
    }
    const colon = text.indexOf(":");
    if (colon === -1) {
      err(`Expected "name: <expression>" in a derived declaration, found "${text}"`);
      return problems;
    }
    const name = text.slice(0, colon).trim();
    const source = text.slice(colon + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      err(`Invalid derived variable name "${name}"`);
      return problems;
    }
    const expr = tryCompile(source, err);
    if (expr) model.derived.push({ name, expr, line, src: text });
    return problems;
  }

  const target = section.target;

  const update = section.kind === "AC" ? UPDATE_RE.exec(text) : null;
  if (update) {
    const expr = tryCompile(update[2], err);
    if (expr) target.updates.push({ target: update[1], expr, line, src: text });
    return problems;
  }

  const kv = KEY_RE.exec(text);
  if (!kv) {
    err(`Cannot read "${text}" inside ${target.id}`);
    return problems;
  }
  const [, key, value] = kv;

  if (key === "requirement" || key === "requirements") {
    const found = refs(value);
    if (!found.length) err(`\`requirement\` on ${target.id} cites no FR-N ("${value.trim()}")`);
    target.requirements.push(...found);
    return problems;
  }

  if (section.kind === "AC") {
    if (key === "requires") {
      const expr = tryCompile(value, err);
      if (!expr) return problems;
      // Several `requires` lines conjoin, so a guard can be written one clause per line.
      target.guard = target.guard
        ? tryCompile(`(${target.guard.src}) and (${expr.src})`, err) || target.guard
        : expr;
      return problems;
    }
    err(`Unknown key \`${key}\` in ${target.id} — expected \`requirement\`, \`requires\`, or \`<var>' = <expr>\``);
    return problems;
  }

  if (section.kind === "INV") {
    if (key === "check" || key === "always") {
      const expr = tryCompile(value, err);
      if (expr) target.check = expr;
      return problems;
    }
    err(`Unknown key \`${key}\` in ${target.id} — expected \`requirement\` or \`check\``);
    return problems;
  }

  if (key === "check") {
    const { claim, problems: claimProblems } = parseClaim(value.trim(), line);
    problems.push(...claimProblems);
    if (!claim) return problems;
    const expr = tryCompile(claim.expr, err);
    if (expr) target.claim = { ...claim, expr };
    return problems;
  }
  err(`Unknown key \`${key}\` in ${target.id} — expected \`requirement\` or \`check\``);
  return problems;
}

function tryCompile(source, err) {
  try {
    return compileExpr(source);
  } catch (e) {
    if (e instanceof ExprError) {
      err(`${e.message} in "${String(source).trim()}"`);
      return null;
    }
    throw e;
  }
}

/** Parse every model in a spec document. */
export function parseModels(text, fromLine = 0) {
  const blocks = findModelBlocks(text, fromLine);
  const models = [];
  const problems = [];
  blocks.forEach((block, index) => {
    const parsed = parseModelBlock(block.src, { startLine: block.startLine, index });
    models.push(parsed.model);
    problems.push(...parsed.problems);
  });
  return { models, problems };
}

/**
 * Semantic checks over parsed models: names resolve, ids referenced by
 * properties exist, and every FR cited by the model is declared by the spec.
 */
export function validateModels(models, { frIds = new Set() } = {}) {
  const problems = [];
  const err = (msg, line) => problems.push({ level: "error", msg, line });
  const warn = (msg, line) => problems.push({ level: "warn", msg, line });

  for (const model of models) {
    const symbols = Object.keys(model.constants ?? {});
    const stateNames = new Set();
    for (const decl of model.state) {
      if (stateNames.has(decl.name)) err(`Duplicate state variable "${decl.name}" in ${model.id}`, decl.line);
      stateNames.add(decl.name);
    }

    const derivedNames = new Set();
    const knownSoFar = new Set(stateNames);
    for (const derived of model.derived) {
      if (stateNames.has(derived.name) || derivedNames.has(derived.name)) {
        err(`Duplicate variable "${derived.name}" in ${model.id}`, derived.line);
      }
      derivedNames.add(derived.name);
      checkRefs(derived.expr, new Set([...knownSoFar, ...symbols]), `derived "${derived.name}"`, derived.line, err, {
        allowPre: false,
      });
      knownSoFar.add(derived.name);
    }
    // Enum symbols are readable everywhere an expression is.
    const readable = new Set([...stateNames, ...derivedNames, ...symbols]);

    if (!model.state.length) {
      warn(`${model.id} declares no state — add a \`state:\` block`, model.line);
    }
    if (!model.actions.length) {
      warn(`${model.id} declares no actions — add an \`AC-N\` block`, model.line);
    }

    const actionById = new Map(model.actions.map((a) => [a.id, a]));

    for (const action of model.actions) {
      const paramNames = new Set(action.params.map((p) => p.name));
      for (const param of action.params) {
        if (readable.has(param.name)) {
          err(`Parameter "${param.name}" of ${action.id} shadows a state variable`, action.line);
        }
      }
      const scope = new Set([...readable, ...paramNames]);
      if (action.guard) {
        checkRefs(action.guard, scope, `guard of ${action.id}`, action.line, err, { allowPre: false });
      }
      if (!action.updates.length) {
        err(`${action.id} has no state update — add at least one \`<var>' = <expr>\` line`, action.line);
      }
      const updated = new Set();
      for (const update of action.updates) {
        if (derivedNames.has(update.target)) {
          err(`${action.id} assigns to derived variable "${update.target}"`, update.line);
        } else if (!stateNames.has(update.target)) {
          err(`${action.id} assigns to undeclared state variable "${update.target}"`, update.line);
        }
        if (updated.has(update.target)) {
          err(`${action.id} assigns "${update.target}" twice`, update.line);
        }
        updated.add(update.target);
        checkRefs(update.expr, scope, `update in ${action.id}`, update.line, err, { allowPre: false });
      }
      checkRequirements(action, frIds, err);
    }

    for (const invariant of model.invariants) {
      if (!invariant.check) {
        err(`${invariant.id} has no \`check\` expression`, invariant.line);
      } else {
        checkRefs(invariant.check, readable, invariant.id, invariant.line, err, { allowPre: false });
      }
      checkRequirements(invariant, frIds, err);
    }

    for (const property of model.properties) {
      if (!property.claim) {
        err(`${property.id} has no \`check\` claim`, property.line);
        checkRequirements(property, frIds, err);
        continue;
      }
      const scope = new Set(readable);
      for (const actionId of property.claim.actions) {
        const action = actionById.get(actionId);
        if (!action) {
          err(`${property.id} references ${actionId}, which no action declares`, property.line);
          continue;
        }
        for (const param of action.params) scope.add(param.name);
      }
      checkRefs(property.claim.expr, scope, property.id, property.line, err, {
        allowPre: property.claim.kind === "after",
      });
      checkRequirements(property, frIds, err);
    }
  }

  return problems;
}

function checkRequirements(element, frIds, err) {
  for (const ref of element.requirements) {
    if (!frIds.has(ref)) {
      err(`${element.id} cites ${ref}, which has no Functional Requirement row`, element.line);
    }
  }
}

function checkRefs(expr, allowed, label, line, err, { allowPre }) {
  const { vars, pre } = freeVars(expr.ast);
  for (const name of vars) {
    if (!allowed.has(name)) err(`Unknown variable "${name}" in ${label}`, line);
  }
  for (const name of pre) {
    if (!allowPre) {
      err(`"${name}@pre" is only valid in an \`after\` property claim (${label})`, line);
      continue;
    }
    if (!allowed.has(name)) err(`Unknown variable "${name}" in ${label}`, line);
  }
}

/** Flatten every model element of one kind across a spec's models. */
export function modelElements(models, kind) {
  const key = { ac: "actions", inv: "invariants", bp: "properties" }[kind];
  return models.flatMap((model) => model[key]);
}

/** One-line summary used by `spec-md model list` and lint output. */
export function describeModel(model) {
  const parts = [
    `${model.actions.length} action${model.actions.length === 1 ? "" : "s"}`,
    `${model.invariants.length} invariant${model.invariants.length === 1 ? "" : "s"}`,
    `${model.properties.length} propert${model.properties.length === 1 ? "y" : "ies"}`,
  ];
  return parts.join(", ");
}
