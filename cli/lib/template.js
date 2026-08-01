/** Render a frontmatter path list as a YAML inline array. */
function yamlList(value, fallback) {
  const items = String(value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return `[${items.join(", ")}]`;
}

/** Scaffold body for `spec-md new <domain>`. */
export function specTemplate({ domain, title, sources, tests }) {
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

<!-- Write every section in Simplified Technical English (ASD-STE100): one
idea per sentence, active voice, plain words, and the same term for the same
thing. Example: "The API rejects a request that has no customerId", not
"Requests lacking a customer identifier will be handled appropriately". -->

### Intro

<!-- One or two paragraphs: the purpose of the system, its role as system of
record, and its lifecycle boundaries. State what is immutable and what flows
downstream. -->

### Definitions

<!-- Shared vocabulary. Only terms specific to this system, or terms that are
ambiguous without a definition. Include the field name where it helps. -->

- ${cap}: <!-- ... -->

### Scope

## In Scope
- <!-- what this system does -->

## Out of Scope
- <!-- what this system does not own -->

### Functional Requirements

<!-- Higher-level, testable statements of intent. One behavior per row, in the
active voice, in 20 words or fewer. FR-N ids must be contiguous and ascending
(FR-1..FR-n). Default: append n+1. -->

| ID   | Requirement |
|------|-------------|
| FR-1 | <!-- ... --> |

### QA Test Cases

<!-- Concrete checks. Several TCs usually prove one FR. TC-N ids must be
contiguous and ascending (TC-1..TC-n). Tests link back through [TC-N].
If you reorder rows, renumber them 1..n and update the [TC-N] tags. -->

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|-------------|----------|------------------|
| TC-1 | FR-1 | <!-- input --> | <!-- expected --> |
`;
}
