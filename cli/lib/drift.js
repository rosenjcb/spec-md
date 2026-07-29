/**
 * Requirement ↔ model drift detection.
 *
 * The formal machinery proves things *below* the model: model → generated
 * tests → implementation. The relationship *above* it — human requirements ↔
 * model — is semantic, so it cannot be proven. What tooling can do is surface
 * likely inconsistencies and force an explicit decision.
 *
 * Everything here is therefore a heuristic warning, never an error, and it only
 * runs for specs that actually declare a model.
 */

const ID_RE = /\b(?:FR|TC|AC|BP|INV|MOD)-\d+\b/g;
const MARKER_RE = /\[(?:REMOVED|NEW|UPDATED)\]/g;
const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

/** Requirement language that implies a constraint the model should guard. */
const BOUND_WORDS =
  /\b(maximum|minimum|at most|at least|no more than|no fewer than|cap|capped|limit|limited|limits|exceed|exceeds|bounded|upper bound|lower bound)\b/i;

const REJECT_WORDS =
  /\b(reject|rejects|refuse|refuses|must not|cannot|may not|invalid|forbid|forbids|prevent|prevents|deny|denies|disallow|disallows|only when|only if)\b/i;

const cleanText = (text) => String(text).replace(MARKER_RE, " ").replace(ID_RE, " ");

/** Every expression source a model element contributes, for literal matching. */
function elementSources(element) {
  if (element.updates) {
    return [element.guard?.src, ...element.updates.map((u) => `${u.target}' = ${u.expr.src}`)].filter(
      Boolean,
    );
  }
  if (element.check) return [element.check.src];
  if (element.claim) return [element.claim.src];
  return [];
}

/**
 * Compare each Functional Requirement against the model elements that claim it.
 * Returns [{ level: "warn", msg, line }].
 */
export function driftWarnings(spec, models) {
  const problems = [];
  if (!models.length) return problems;
  const warn = (msg, line) => problems.push({ level: "warn", msg, line });

  const elements = models.flatMap((model) => [
    ...model.actions,
    ...model.invariants,
    ...model.properties,
  ]);
  if (!elements.length) return problems;

  const byRequirement = new Map();
  for (const element of elements) {
    for (const id of element.requirements) {
      if (!byRequirement.has(id)) byRequirement.set(id, []);
      byRequirement.get(id).push(element);
    }
    if (!element.requirements.length) {
      warn(`${element.id} cites no Functional Requirement — the model is not traceable to intent`, element.line);
    }
  }

  for (const fr of spec.frs) {
    if (fr.removed) continue;
    const tracing = byRequirement.get(fr.id);
    if (!tracing?.length) continue; // the model makes no claim about this FR
    const text = cleanText(fr.text);
    const sources = tracing.flatMap(elementSources).join(" ; ");
    const actions = tracing.filter((element) => element.updates);
    const cited = tracing.map((element) => element.id).join(", ");

    // A number named by the requirement should appear somewhere in the contract.
    const numbers = [...new Set(text.match(NUMBER_RE) || [])];
    const sourceNumbers = new Set(sources.match(NUMBER_RE) || []);
    const missing = numbers.filter((n) => !sourceNumbers.has(n));
    if (missing.length) {
      warn(
        `Potential requirement/model drift: ${fr.id} mentions ${missing.join(", ")}, ` +
          `which no model element tracing to it (${cited}) references — the model may need a guard`,
        fr.line,
      );
    }

    // Bounds and rejections are guards. If none of the actions has one, say so.
    if (actions.length && !actions.some((action) => action.guard)) {
      const bound = BOUND_WORDS.exec(text);
      const reject = REJECT_WORDS.exec(text);
      const phrase = bound?.[0] || reject?.[0];
      if (phrase) {
        warn(
          `Potential requirement/model drift: ${fr.id} constrains behavior ("${phrase}"), but ` +
            `${actions.map((a) => a.id).join(", ")} declare${actions.length === 1 ? "s" : ""} ` +
            "no `requires:` guard",
          fr.line,
        );
      }
    }

    // An edited requirement is the usual way the model falls behind.
    if (fr.markers.includes("UPDATED")) {
      warn(
        `${fr.id} is marked [UPDATED] — confirm the model elements tracing to it (${cited}) still match`,
        fr.line,
      );
    }
  }

  // State nobody writes and nobody reads is a leftover from an earlier model.
  for (const model of models) {
    const written = new Set();
    for (const action of model.actions) for (const update of action.updates) written.add(update.target);
    const read = new Set();
    for (const source of [
      ...model.derived.map((d) => d.expr.src),
      ...model.actions.flatMap(elementSources),
      ...model.invariants.flatMap(elementSources),
      ...model.properties.flatMap(elementSources),
    ]) {
      for (const name of source.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) read.add(name);
    }
    for (const decl of model.state) {
      if (written.has(decl.name) || read.has(decl.name)) continue;
      warn(
        `State variable "${decl.name}" in ${model.id} is never updated by an action nor read by ` +
          `an invariant or property — it is not part of the contract`,
        decl.line,
      );
    }
  }

  return problems;
}
