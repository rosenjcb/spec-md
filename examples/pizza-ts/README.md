# pizza-ts

A small, dependency-light reference example for the **spec.md** standard.

It implements a pizza ordering API directly from a single OKF spec —
[`specs/order.spec.md`](specs/order.spec.md) — and shows how the spec's
Functional Requirements (FR-*) and QA Test Cases (TC-*) trace into code, unit
tests, and live HTTP integration requests, plus how its **behavioral model**
(`MOD-1`) is conformance-tested against the running implementation.

> The documents under `specs/` (`order.spec.md`, `order.review.md`) follow
> the OKF/spec.md format. The READMEs here are ordinary developer docs.

## Stack

- **TypeScript** (ESM, strict)
- **Express 4** — the HTTP server
- **Vitest** — unit + HTTP-level tests
- **tsx** — run TypeScript directly, no build step
- **httpyac** / IntelliJ `.http` — integration requests in [`http/`](http/)
- **spec-md model** — the behavioral model in the spec, driven through
  [`model/orders.adapter.mjs`](model/orders.adapter.mjs)

Relative imports use `.ts` extensions so Node can load `src/` directly (type
stripping, Node ≥ 22.18) — that is what lets the conformance adapter drive the
real `OrderStore` with no build step.

## Layout

```
pizza-ts/
├── specs/
│   ├── order.spec.md     # the OKF spec — the source of truth
│   └── order.review.md   # the review record (type: Review) — roles, briefings, sign-off
├── src/
│   ├── orders/           # the orders domain
│   │   ├── types.ts          # domain types (mirror the Definitions)
│   │   ├── menu.ts           # catalogue + size pricing (FR-2)
│   │   └── orders.ts         # validation, pricing, immutable store (FR-1,3,4)
│   ├── app.ts            # Express routes — HTTP adapter (FR-1,2,5)
│   └── index.ts          # server entrypoint
├── test/
│   └── orders/           # the orders domain test suite
│       ├── menu.test.ts      # pricing units
│       ├── orders.test.ts    # order service units (TC-1, TC-4..TC-9)
│       └── app.test.ts       # HTTP-level tests (TC-1, TC-2, TC-6, TC-9)
├── model/
│   └── orders.adapter.mjs    # bridges MOD-1 to OrderStore for `model test`
└── http/                 # live integration requests (.http + httpyac)
```

The domain lives in its own folder, `src/orders/`, while `src/app.ts` is the
HTTP adapter that sits outside it. That lets the spec's `sources` field show
both a **folder** reference (`../src/orders`) and an **individual file**
reference (`../src/app.ts`). The `tests` field does the same — a folder
(`../test/orders`) plus a single file (`../http/orders.http`).

## Getting started

```bash
cd examples/pizza-ts
npm install

npm run start        # serve on http://localhost:3000
npm test             # run the vitest suites
npm run build        # type-check only (tsc --noEmit)

npm run model:list   # print the behavioral contract
npm run model:check  # explore the model on its own
npm run model:test   # conformance: OrderStore vs. MOD-1
npm run check        # lint + [TC-N] coverage + model check + conformance
```

The `model:*` scripts need none of this example's dependencies — they only read
the spec and import `src/` — but they do need `@rosenjcb/spec-md` ≥ 0.4.0. From a
checkout of this repository, `node ../../cli/bin/spec-md.js model test .` runs the
local CLI directly.

## API

| Method | Path          | Description                          | Spec |
|--------|---------------|--------------------------------------|------|
| GET    | `/health`     | Liveness probe                       | —    |
| GET    | `/menu`       | List pizzas and base prices          | FR-2 |
| POST   | `/orders`     | Create an order from a request       | FR-1, FR-2, FR-4 |
| GET    | `/orders/:id` | Fetch a previously created order     | FR-5 |

Prices are in **whole cents**. Size multipliers: `small` ×1, `medium` ×1.3,
`large` ×1.6 (rounded to the nearest cent).

### Example

```bash
curl -s localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"customerId":"cust-1","items":[{"pizzaId":"pepperoni","size":"large","quantity":2}]}'
```

## Integration tests

The [`http/`](http/) folder holds `.http` requests runnable from IntelliJ or
httpyac, with assertions tied to the spec's QA Test Cases. See
[`http/README.md`](http/README.md).

## How this maps to the spec

The spec's metadata splits the system into two relative-path fields, each
mixing a folder reference with an individual file:

- `sources` → `[../src/orders, ../src/app.ts]` — the orders domain folder plus
  the HTTP adapter file that enforce the requirements.
- `tests` → `[../test/orders, ../http/orders.http]` — the orders test suite
  folder plus the `.http` integration requests that prove them.

Both are relative to `specs/order.spec.md` and are optional, but here they keep
the spec wired to both the code and its verification.

Every requirement and test case in [`specs/order.spec.md`](specs/order.spec.md)
has a home in the code. A requirement is higher-level than a single check, so
one `FR` can own several `TC`s:

- **FR-1** (TC-1) → `OrderStore.create` + `POST /orders`
- **FR-2** (TC-2, TC-3, TC-4) → `unitPriceFor`, `SIZE_MULTIPLIER`, total computation
- **FR-3** (TC-5) → `structuredClone` on store read/write (immutability)
- **FR-4** (TC-6, TC-7, TC-8) → validation in `priceItem` / `OrderStore.create`
- **FR-5** (TC-9) → `OrderStore.get` + `GET /orders/:id`

## The behavioral model

The spec's `### Behavioral Model` section holds `MOD-1`: the ordering lifecycle
as state (`status`, `lineCount`, `total`), two actions (`AC-1 AddItem`,
`AC-2 PlaceOrder`), two invariants, and two properties. It is the same contract
the `FR-N` rows state in prose, written precisely enough to execute.

```bash
node ../../cli/bin/spec-md.js model test .
```

```text
✓ MOD-1 Orders examples/pizza-ts/specs/order.spec.md
  1000 trace(s), 3646 action(s), 4646 observation(s) conform

✓ 1 model(s) conform, 0 failure(s)
```

Those traces are every order shape the model can build within its bounds — up
to three lines across three sizes and two quantities, placed or still drafting —
checked against the real `OrderStore` after every action. The nine `TC-N` rows
cover nine named examples; this covers the combinations nobody wrote down.

**What that buys you.** Suppose someone caps the order total, a change no
reviewer would blink at:

```diff
-const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
+const total = Math.min(items.reduce((sum, item) => sum + item.lineTotal, 0), 5000);
```

Every unit test still passes — `TC-4`'s order comes to 4420, comfortably under
the cap. Conformance finds the shortest order that does not:

```text
Behavioral conformance failed

Spec: Pizza Orders
Model: MOD-1 Orders

Minimal counterexample:
  Initial state: status = "draft", lineCount = 0, total = 0, basePrice = 900, placed = false
  Trace:
    1. AC-1 AddItem(sizeMultiplier = 1.3, quantity = 2) → status = "draft", lineCount = 1, total = 2340, basePrice = 900
    2. AC-1 AddItem(sizeMultiplier = 1.6, quantity = 2) → status = "draft", lineCount = 2, total = 5220, basePrice = 900
    3. AC-2 PlaceOrder → status = "created", lineCount = 2, total = 5220, basePrice = 900

Expected:
  total = 5220

Observed:
  total = 5000

Relevant contract:
  FR-1: Create an order from a request with a customer and at least one item
  FR-2: Compute line and order totals from menu price and size multiplier
  AC-2 requires: status = draft and lineCount > 0
  AC-2: status' = created
  AC-1: total' = total + round(basePrice * sizeMultiplier) * quantity
  INV-2: (lineCount = 0) = (total = 0)
  BP-1: after AC-1, total = total@pre + round(basePrice * sizeMultiplier) * quantity
  BP-2: after AC-2, total = total@pre and lineCount = lineCount@pre

Possible resolutions:
  - Restore implementation behavior so it still follows AC-1
  - Update FR-1, FR-2 and AC-1 to define the new behavior, then add the QA Test Case that pins the boundary
```

The value is not the failure — it is that the failure forces a decision. Either
the cap goes, or `FR-2` gains a maximum order value, which forces `AC-1` to
change, which forces a `TC-N` for the boundary. Nothing silently redefines the
product.

The adapter is where the model meets reality: it maps the model's size
*multipliers* onto menu sizes, and reports `total` only once the order exists,
because `OrderStore` prices atomically. Translation belongs there so the model
can stay an abstraction. Full reference: [MODELS.md](../../MODELS.md).

## Review & sign-off

The spec also demonstrates the [review convention](../../REVIEW.md): its
`review` key points at [`specs/order.review.md`](specs/order.review.md), an
OKF document of `type: Review` whose `spec` key points back. The record's
frontmatter carries the roles (`driver`, `approvers`, `contributors`,
`informed`), the `mode` and `milestone`, the pinned spec `revision` — and
the approval state. `status: approved` lives on the review, not the spec:
approval is a property of the review.

The record is one go/no-go review. Every stakeholder gets a **briefing
written for their role** — Buck approves business boundaries, Joe Jack gets
the acceptance cases, Enrique gets the flow constraints — each derived from
the spec and citing the sections and `FR-N`/`TC-N` rows it summarizes.
Nothing is maintained by hand: if the spec later changes enough to need
re-review, the record is regenerated in place and git history keeps the old
round.

In CI, `spec-md check --require-approved` turns this into a merge gate: a
spec whose linked review is still `status: open` fails the check until the
sign-off lands.
