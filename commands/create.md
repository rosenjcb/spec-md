---
description: Author a new *.spec.md for a feature or domain, derived from the real code and tests.
argument-hint: <domain or path, e.g. "orders" or src/billing>
---

Create a `*.spec.md` for: **$ARGUMENTS**

Use the **spec-md** skill. Triage first (skill Step 0): confirm no spec
already covers this domain (otherwise use `/spec-md:update`), and decide from
the request's scale whether stakeholder sign-off will be needed — classify
when clear, ask only when not. Then follow the "create" path:

1. Gather context from the real system — read the code under the target area
   (branching, validation, lifecycle states), any existing docs/tickets, and
   locate the `sources` and `tests` paths.
2. Write the spec with OKF frontmatter (`type`, `title`, `sources`, `tests`),
   then Intro, Definitions, Scope, Functional Requirements (`FR-N`), and QA
   Test Cases (`TC-N`). Derive requirements from the code — do not invent
   structure.
3. Name it `<domain>.spec.md` and place it next to the code it describes or in
   a `specs/` directory; set `sources`/`tests` relative to that location.
4. If triage said the spec needs sign-off, create `<domain>.review.md` next
   to it (skill Step 5) — `type: Review`, roles, per-stakeholder briefings,
   `status: open` — and link the two. Leave it `open`; only the user's word
   flips it to `approved`.

If `$ARGUMENTS` is empty, ask which feature or domain to spec, then proceed.

When the draft is ready, run `npx @rosenjcb/spec-md lint <file>` (if available) and fix any
errors before finishing.
