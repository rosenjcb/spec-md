---
name: spec-md
description: Author or update a *.spec.md file — an Open Knowledge Format spec that captures a system's intent, behavior, and verification so both humans and agents stay aligned. Produces OKF metadata, Intro, Definitions, Scope, Functional Requirements (FR-N), and QA Test Cases (TC-N). Also writes the optional executable Behavioral Model (MOD-N state transitions, AC-N actions, INV-N invariants, BP-N properties) and the optional *.review.md sign-off record (stakeholder roles, per-role briefings, approval state).
---

# spec.md

Write a `*.spec.md` file: the authoritative, living description of a system —
what it does, why it exists, and how it should behave. A spec is shared context
for Product, Engineering, QA, and agents, structured as a
[spec.md](https://github.com/rosenjcb/spec.md) document (an Open Knowledge Format
extension) so it stays machine-readable and synchronized with the system it
describes.

## When to use

- A feature or domain has behavior worth pinning down before (or while) it is built
- QA reports failures and you need to formalize what "correct" means
- Code exists but no spec traces intent to implementation and tests
- You need to align engineering and QA on expected behavior before release
- Behavior is worth pinning down mechanically, so an implementation change
  cannot silently redefine it (the Behavioral Model layer)
- A spec needs stakeholder sign-off, or a sign-off was granted and the
  review record must be updated

## Step 0: Triage

Before touching files, settle three things. Classify them from the user's
request and the state of the repo when the signal is clear; ask — one or two
questions, not a quiz — only when it is not.

1. **Create or update?** Look before asking: a `*.spec.md` already covering
   the domain → update it (Step 1, then **Step 2u**). None → create one
   (Step 1, then Step 2). The rest (Steps 2m–5) applies to both.
2. **Is it worth a behavioral model?** Most specs are not. Write one (Step
   2m) when the domain has **state that changes over time** and behavior worth
   protecting mechanically — a lifecycle, a counter, a cart, a state machine —
   or when the user asks for drift detection or conformance testing. Skip it
   for pure request/response validation, presentation, and configuration; say
   so and move on. A model that only restates one `FR-N` earns nothing.
3. **Will it need a review?** Judge the scale of what is being asked:
   **ambiguity** (could two reasonable people build different things?),
   **blast radius** (how much inherits a mistake?), and **stakeholder
   spread** (does anyone outside the PR need to agree?). Small and
   unambiguous → no review; say so and move on. Clearly risky or
   cross-team → plan a review record (Step 5) and confirm who is involved.
   Genuinely unclear → ask the user directly.

The review decision is made **here, up front**; the record itself is written
in Step 5, once there is a spec to derive it from.

The critical update rule: **every id sequence must stay contiguous and
ascending** — `FR-1..FR-n` and `TC-1..TC-n` in table order, and
`MOD-1..MOD-n` / `AC-1..AC-n` / `INV-1..INV-n` / `BP-1..BP-n` in model order.
No skips, no jumbled mid-table inserts. `spec-md lint` enforces this. Default
edit is append-only (`n + 1` at the end). Cleanup that reshuffles rows must
renumber `1..n` in the new order and update every matching `[TC-N]` test tag
in the same change — never leave gaps or out-of-order ids.

## Step 1: Gather context

Derive the spec from the real system — do not invent structure.

1. **Read the code.** Branching logic, validation, and lifecycle states become
   your Functional Requirements and the dimensions your Test Cases must cover.
2. **Read existing docs.** Tickets, `.context.md`, prior specs, e2e cases.
3. **Locate `sources` and `tests`.** Which paths implement the spec, which prove
   it. These become metadata.
4. **When updating, read the current spec first** and diff its claims against the
   code and tests as they are now. Note what drifted: new behavior with no
   `FR-N`, requirements whose behavior changed, `TC-N` rows that no longer match,
   tests with no row (or rows with no test).
5. **Ask only when blocked.** One or two questions at a time; present what you
   found in the code and confirm.

## Step 2: Write the spec (create)

Naming: `<domain>.spec.md` (e.g. `order.spec.md`). Place it wherever fits the
project — next to the code it describes (`src/orders/order.spec.md`) or in a
dedicated specs directory. Location does not matter; `sources` and `tests` are
relative to the spec file, so set those paths to match wherever you put it.
Keep every section tight — each sentence earns its place. **Golden rule:** the
more filler a reader must skim, the less the spec compels. Prefer a short
spec that links to deeper material ([TESTING.md](./TESTING.md),
[REVIEW.md](./REVIEW.md), examples) over pasting checklists or restating
companion docs inline.

### Metadata (frontmatter)

Only `type` and `title` are required; add the rest as the spec matures.

```yaml
---
type: Spec
title: "Spec: Orders"
sources: [./src/orders]
tests: [./test/orders, ./http/orders.http]
description: The specification for the Orders domain
resource: https://notion.com/read_only_publish_page_location
tags: [sales, orders, revenue]
timestamp: 2026-05-28T14:30:00Z
---
```

| Key | Required | Purpose |
|-----|----------|---------|
| `type` | **Yes** | Always `Spec` for a spec.md file. |
| `title` | **Yes** | Human-readable name. |
| `sources` | No | YAML list of **spec-relative** paths to code/schemas/docs that implement the spec. |
| `tests` | No | YAML list of spec-relative paths to verification (unit suites, `.http`, e2e). |
| `description` | No | One-line summary. |
| `resource` | No | External URL where the spec is published/synced. |
| `review` | No | Spec-relative path to the sign-off record (see Step 5). |
| `tags` | No | Freeform labels for grouping. |
| `timestamp` | No | ISO 8601 of last update. |

`sources` is *what the system does*; `tests` is *what proves it*. Both are
YAML lists of paths relative to the spec file, so the spec stays portable.
Omit either if it does not exist yet.

### Intro

One or two paragraphs: the system's purpose, its role as system of record, and
its lifecycle boundaries (what is immutable, what flows downstream).

### Definitions

Shared vocabulary used across the spec. Only terms specific to this system or
ambiguous without definition. Include the field name where it helps
(`customerId`, `basePrice` in cents).

```md
### Definitions

- Order: A completed purchase transaction, identified by `id`.
- Order Total: Final amount after discounts, taxes, and adjustments, in cents.
- Status: Lifecycle state (CREATED, PAID, FULFILLED, REFUNDED).
```

### Scope

Two lists under `## In Scope` and `## Out of Scope`. This prevents
responsibility drift — be explicit about what the system does *not* own.

### Functional Requirements

A table of `FR-N` rows. Each is a **higher-level, testable** statement of intent
— not a vague goal and not an implementation detail. One behavior per row.

```md
### Functional Requirements

| ID   | Requirement |
|------|-------------|
| FR-1 | Create an order from a request with a customer and at least one item |
| FR-2 | Compute line and order totals from price and size multiplier |
| FR-3 | Prevent modification of an order after creation |
| FR-4 | Reject requests missing a customer or with invalid items |
```

### QA Test Cases

A table of `TC-N` rows, each citing the `FR-N` it proves. A single FR is usually
proven by **several** test cases (e.g. pricing → size, quantity, rounding). Each
row is a deterministic, concrete check — exact input, exact expected outcome.

```md
### QA Test Cases

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|-------------|----------|------------------|
| TC-1 | FR-1 | Valid request submitted | Order created with status CREATED |
| TC-2 | FR-2 | Larger size priced | Unit price scaled by multiplier, rounded |
| TC-3 | FR-4 | Missing customerId | 400 validation error |
| TC-4 | FR-4 | Empty items list | 400 validation error |
```

Cover happy path first, then edge cases, then error conditions. Prefer writing
related cases under the FR they belong to **in the order you want them to keep**
— ids will be `TC-1..TC-n` in that table order. Be concrete:
`[owner, downlineA, unrelated]` beats "a mixed array".

## Step 2u: Update the spec

Edit the existing file in place — keep the prose and IDs that still hold, change
only what drifted. Apply the same section rules as Step 2, plus:

- **Keep ids contiguous and ascending.** Every FR/TC table must be exactly
  `FR-1..FR-n` / `TC-1..TC-n` in row order — no skips, no out-of-order rows.
  `spec-md lint` fails otherwise.
- **Default: append.** New requirements / cases take `n + 1` and go at the
  **end** of the table. Scan the table for the current count (and confirm it
  matches the highest `N`) before allocating. Never invent a mid-range id
  (`TC-84` when the table ends at `TC-4`), never reuse a live id, never copy
  an id from another spec.
- **Cleanup after every insert / remove / edit.** If rows are jumbled, skipped,
  or clustered wrong:
  1. Reorder for readability — FR by domain/lifecycle; TC by the `FR-N` they
     prove (happy → edge → error within each group).
  2. **Renumber** the table to `1..n` in that new order.
  3. Update every `[TC-N]` test tag (and any review briefings citing ids) to
     match — in the same change.
  Do not leave `TC-1, TC-2, TC-84, TC-3`. Do not renumber without updating tags.
- **Edit a row in place** when behavior changed but the requirement is the same —
  update its text, not its number (append-only path).
- **Mark removed behavior** rather than deleting silently: append `[REMOVED]` to
  the row (and remove its `[TC-N]` tests) so reviewers see the change. A
  `[REMOVED]` row still occupies its index (sequence stays contiguous). When
  nothing references it anymore, delete the row and **compact**: renumber the
  remainder to `1..n` and update tags.
- **Mark new or changed rows** with `[NEW]` or `[UPDATED]` while the change is in
  review; drop the marker once merged.
- **Reconcile metadata.** Update `sources`/`tests` if paths moved, and always
  bump `timestamp` to the current time.
- **Finish with lint.** Run `spec-md lint` (or `check`) on the file and fix any
  sequence / duplicate / dangling-reference errors before considering the
  update done.
- **Keep the model in step.** If the spec has a `### Behavioral Model` and a
  requirement's behavior changed, update the model in the same edit (Step 2m).
  `spec-md lint` warns when a requirement names a bound the model does not
  guard, or when an `[UPDATED]` row's model elements may be stale.

## Step 2m: The behavioral model (only if triage said so)

Skip this entirely unless Step 0 called for it — most specs need no model. The
full language reference is
[MODELS.md](https://github.com/rosenjcb/spec.md/blob/main/MODELS.md).

Add a `### Behavioral Model` section holding a fenced ` ```spec-model ` block.
The **state transition model is primary**; invariants and properties are
additional claims about it.

````md
```spec-model
model: MOD-1 Orders
adapter: ../model/orders.adapter.mjs

state:
  status: string in [draft, created] = draft
  lineCount: integer in 0..3 = 0
  total: integer in 0..20000 = 0

AC-1 AddItem(unitPrice: integer in 900..1440, quantity: integer in 1..2):
  requirement: FR-2
  requires: status = draft
  lineCount' = lineCount + 1
  total' = total + unitPrice * quantity

AC-2 PlaceOrder:
  requirement: FR-1
  requires: status = draft and lineCount > 0
  status' = created

INV-1 A placed order has at least one priced line:
  requirement: FR-1
  check: status = created implies lineCount > 0

BP-1 Each line adds unit price times quantity to the total:
  requirement: FR-2
  check: after AC-1, total = total@pre + unitPrice * quantity
```
````

Rules that matter:

- **Model the abstraction, not the data structure.** State is scalar
  (`integer`, `number`, `boolean`, `string`) — model `lineCount` and `total`,
  never the array of items. Pick the smallest state that still says something.
- **Only model what the implementation can be driven through and observed at.**
  An action needs a real operation behind it and a way to read the result back;
  a value that is not observable yet is one the adapter simply omits.
- **One `AC-N` per operation**, each citing the `FR-N` it implements
  (`requirement:`). Every right-hand side (`count' = …`) reads the pre-state.
  Put preconditions in `requires:`; a requirement that says "reject", "must
  not", or names a maximum almost always means a guard.
- **`in lo..hi` / `in [a, b]` is an exploration bound, not a requirement.** It
  picks which starting values and arguments to try and where the walk stops.
  Never encode a real constraint there — that is what `INV-N` is for.
- **Write invariants for what must always hold**, properties for the guarantees
  worth naming. Do not try to enumerate every behavior as a `BP-N`: exploration
  covers the combinations, so a missing property is not a hole in the contract.
  Invariants do double duty: they also decide which generated initial states are
  valid, so a tightly coupled state needs them to stay coherent.
- **Say what the model leaves out.** Input validation and caller-side aliasing
  are not state transitions; note in the section that those `FR-N` stay proven
  by their `TC-N` rows rather than pretending the model covers them.
- **Derive from the code**, exactly as for `FR-N`: if the implementation
  branches on it, the model should guard on it.
- **Add an `adapter:`** only when the implementation exists and can be driven
  from Node. Write the adapter (`init` / `actions` / `observe`) next to the
  tests, keyed by `AC-N`, and let it translate shapes so the model stays
  abstract.
- **Finish by running it**: `spec-md model check <path>` must be clean, and
  `spec-md model test <path>` too when there is an adapter. A violation is
  either a wrong model or a wrong implementation — say which, do not loosen the
  model to make the check pass.

## Step 3: Link the tests

Tests trace back to the spec via a bracketed `[TC-N]` prefix on the test name —
the join key between spec and suite. See
[TESTING.md](https://github.com/rosenjcb/spec.md/blob/main/TESTING.md) for the
full convention.

```ts
it("[TC-3] Given a request without a customerId, when the order is created, then a ValidationError is thrown", () => { ... });
```

Coverage is greppable: every `TC-N` in the spec should have at least one
`[TC-N]` test. A test with no matching row is a signal to add the `TC-N` — or
tag it `[smoke]` if it is not an acceptance criterion.

A `TC-N` may also cite the model element it exercises, completing the chain
`FR-1 → BP-1 → AC-1 → TC-1 → [TC-1] test → implementation`:

```md
| TC-2 | FR-1, AC-1 | Counter at 100, incremented | Counter is 101 |
```

## Step 4: Flag gaps

- Mark ambiguous behavior with `??` and call it out.
- Note known mismatches between code and spec in a short "Known issues" section.
- Flag any `FR-N` with no `TC-N`, and any `TC-N` with no `[TC-N]` test.
- Flag duplicate ids, skipped numbers, or out-of-order FR/TC rows — fix by
  reordering then renumbering `1..n` and updating `[TC-N]` tags before finishing.
- When the spec has a model: flag any `BP-N` exploration never exercised, any
  model element citing no `FR-N`, and any drift warning `spec-md lint` raises
  between a requirement and the model.

## Step 5: The review record (only if triage said so)

Whether a review is needed was settled in Step 0 — most specs need none; if
that was the answer, stop here and create no record. The full convention is
[REVIEW.md](https://github.com/rosenjcb/spec.md/blob/main/REVIEW.md).

If a review is needed, create `<domain>.review.md` next to the spec and
link the two:

1. Ask who holds the roles — driver, approver(s) (ideally one),
   contributors, informed — plus the mode (`notice` or `signoff`), the
   milestone (`kickoff`, `pre-build`, `pre-release`), and a deadline.
2. Write the record's frontmatter: `type: Review`, `title`,
   `spec: ./<domain>.spec.md`, `revision` (the spec's current commit), the
   roles, the deadline — and, for a `signoff`, `status: open`. A `notice`
   has nothing to approve and omits `status`. Add
   `review: ./<domain>.review.md` to the spec's frontmatter.
3. Write the body: an instruction paragraph stating the goal, a roles table
   (checkboxes for approvers only), and a **briefing per stakeholder** —
   written for that person's role and concerns, derived from the spec,
   citing the sections and `FR-N`/`TC-N` rows it summarizes. Never
   hand-author restatements; never hand someone a generic section link.

**Never set `status: approved` yourself.** The record stays `open` until
the user says sign-off actually happened. Then: check the approver boxes
with dates, write the **Outcome** line, flip `status: approved`, and bump
the record's `timestamp`. If the review was declined, set
`status: rejected` and record why.

When updating a spec that links an approved review, ask whether the change
warrants re-review. If it does, regenerate the record in place — new
`revision`, `status: open`, fresh briefings covering the delta by
`FR-N`/`TC-N` id. Git history keeps the old round; do not append rounds to
the file.

Hand-off is manual by design: the record is one document, so give
stakeholders the document — a link to the file or its `resource` mirror,
over Slack or email. Do not build or wire up notification machinery.

## Principles

- **Succinct, then deeper.** More prose a reader must wade through, less likely
  they are compelled by the spec. Keep the `*.spec.md` short: intent, scope,
  `FR-N`, `TC-N`. Link out for depth — [TESTING.md](./TESTING.md),
  [MODELS.md](./MODELS.md), [REVIEW.md](./REVIEW.md), examples — instead of
  pasting checklists or restating companion docs. Each layer earns its place;
  nothing repeats what the layer above already said.
- **Tests protect examples; a model protects behavior.** `TC-N` rows pin the
  cases someone thought of. When that is not enough — when a change could
  silently redefine the product — the model is the layer that makes drift fail
  a check instead of shipping.
- **Derive from the code.** If the code branches on it, a requirement and a test
  case should cover it — including null/unknown values.
- **Concrete over abstract.** Exact inputs and outputs, not descriptions of them.
- **Intent, not implementation.** Describe *what* should happen, never *how* the
  code does it.
- **Living, not frozen.** Enough detail to remove ambiguity, not so much rigidity
  that it goes stale. Update `timestamp` and the relevant rows as the system
  evolves rather than rewriting wholesale.
- **Id hygiene.** After every insert, remove, or edit: every sequence must stay
  ascending with no skips — `FR-1..FR-n` / `TC-1..TC-n` in the tables,
  `MOD`/`AC`/`INV`/`BP` in the model. Reorder for readability, then renumber and
  update `[TC-N]` tags when needed. Lint is the gate.
