/** Render a frontmatter path list as a YAML inline array. */
function yamlList(value, fallback) {
  const items = String(value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return `[${items.join(", ")}]`;
}

/**
 * The optional Behavioral Model section (`spec-md new <domain> --model`).
 * Kept out of the default scaffold: a model is worth writing when behavior is
 * worth pinning down mechanically, not for every spec.
 */
function modelSection(cap) {
  return `
### Behavioral Model

<!-- The executable contract: state, actions (AC-N), invariants (INV-N), and
behavioral properties (BP-N). \`spec-md model check\` explores it; with an
\`adapter\`, \`spec-md model test\` checks the implementation conforms.
Language reference: https://github.com/rosenjcb/spec.md/blob/main/MODELS.md -->

\`\`\`spec-model
model: MOD-1 ${cap}
# adapter: ./test/${cap.toLowerCase()}.adapter.mjs

# State is an abstraction of the implementation, not a copy of it.
# \`in 0..100\` bounds generation (initial states, arguments) — not behavior.
state:
  value: integer in 0..100 = 0

# One action per operation. Every right-hand side reads the pre-state.
AC-1 Change:
  requirement: FR-1
  # requires: value < 100
  value' = value + 1

# Invariants must hold in every explored state.
INV-1 Value stays non-negative:
  requirement: FR-1
  check: value >= 0

# Properties are named claims about the model. Exploration covers the rest.
BP-1 Change steps by exactly one:
  requirement: FR-1
  check: after AC-1, value = value@pre + 1
\`\`\`
`;
}

/** Scaffold body for `spec-md new <domain>`. */
export function specTemplate({ domain, title, sources, tests, model = false }) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const cap = domain.charAt(0).toUpperCase() + domain.slice(1);
  return `---
type: Spec
title: "Spec: ${title || cap}"
sources: ${yamlList(sources, `./src/${domain}`)}
tests: ${yamlList(tests, `./test/${domain}`)}
description: The specification for the ${cap} domain
tags: [${domain}]
timestamp: ${now}
---

### Intro

<!-- One or two paragraphs: the system's purpose, its role as system of
record, and its lifecycle boundaries (what is immutable, what flows
downstream). -->

### Definitions

<!-- Shared vocabulary. Only terms specific to this system or ambiguous
without definition. Include the field name where it helps. -->

- ${cap}: <!-- ... -->

### Scope

## In Scope
- <!-- what this system does -->

## Out of Scope
- <!-- what this system explicitly does not own -->

### Functional Requirements

<!-- Higher-level, testable statements of intent. One behavior per row.
FR-N ids must be contiguous and ascending (FR-1..FR-n). Default: append n+1. -->

| ID   | Requirement |
|------|-------------|
| FR-1 | <!-- ... --> |

### QA Test Cases

<!-- Concrete checks. A single FR is usually proven by several TCs.
TC-N ids must be contiguous and ascending (TC-1..TC-n). Tests link via [TC-N].
Cleanup that reorders rows must renumber 1..n and update [TC-N] tags. -->

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|-------------|----------|------------------|
| TC-1 | FR-1 | <!-- input --> | <!-- expected --> |
${model ? modelSection(cap) : ""}`;
}
