# pizza-ts

A small reference example for the **spec.md** standard, with few dependencies.

It implements a pizza order API directly from one OKF spec —
[`specs/order.spec.md`](specs/order.spec.md) — and shows how the Functional
Requirements (FR-*) and the QA Test Cases (TC-*) of the spec trace into the
code, the unit tests, and the live HTTP integration requests.

> The documents under `specs/` (`order.spec.md`, `order.review.md`) follow the
> OKF/spec.md format, and they are written in
> [Simplified Technical English](../../README.md#the-language) — as are the
> test names that carry the `[TC-N]` tags. The READMEs here are ordinary
> developer docs.

## Stack

- **TypeScript** (ESM, strict)
- **Express 4** — the HTTP server
- **Vitest** — unit + HTTP-level tests
- **tsx** — run TypeScript directly, no build step
- **httpyac** / IntelliJ `.http` — integration requests in [`http/`](http/)

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
└── http/                 # live integration requests (.http + httpyac)
```

The domain has its own folder, `src/orders/`, and `src/app.ts` is the HTTP
adapter outside it. The `sources` field of the spec can therefore show a
**folder** reference (`../src/orders`) and an **individual file** reference
(`../src/app.ts`). The `tests` field does the same: a folder
(`../test/orders`) and one file (`../http/orders.http`).

## Getting started

```bash
cd examples/pizza-ts
npm install

npm run start        # serve on http://localhost:3000
npm test             # run the vitest suites
npm run build        # type-check only (tsc --noEmit)
```

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

The metadata of the spec divides the system into two relative-path fields. Each
field holds a folder reference and an individual file:

- `sources` → `[../src/orders, ../src/app.ts]` — the orders domain folder and
  the HTTP adapter file that enforce the requirements.
- `tests` → `[../test/orders, ../http/orders.http]` — the orders test suite
  folder and the `.http` integration requests that prove them.

Both fields are relative to `specs/order.spec.md`, and both are optional. Here
they connect the spec to the code and to its verification.

Every requirement and test case in [`specs/order.spec.md`](specs/order.spec.md)
has a place in the code. A requirement is higher-level than one check, so one
`FR` can own several `TC` rows:

- **FR-1** (TC-1) → `OrderStore.create` + `POST /orders`
- **FR-2** (TC-2, TC-3, TC-4) → `unitPriceFor`, `SIZE_MULTIPLIER`, total computation
- **FR-3** (TC-5) → `structuredClone` on store read/write (immutability)
- **FR-4** (TC-6, TC-7, TC-8) → validation in `priceItem` / `OrderStore.create`
- **FR-5** (TC-9) → `OrderStore.get` + `GET /orders/:id`

## Review & sign-off

The spec also demonstrates the [review convention](../../REVIEW.md). Its
`review` key points at [`specs/order.review.md`](specs/order.review.md), an OKF
document of `type: Review` whose `spec` key points back. The frontmatter of the
record carries the roles (`driver`, `approvers`, `contributors`, `informed`),
the `mode` and the `milestone`, the pinned spec `revision`, and the approval
state. `status: approved` belongs to the review, not to the spec, because
approval is a property of the review.

The record is one go or no-go review. Every stakeholder gets a **briefing
written for their role**: Buck approves the business boundaries, Joe Jack gets
the acceptance cases, and Enrique gets the constraints on the flow. Each
briefing comes from the spec and cites the sections and the `FR-N`/`TC-N` rows
that it summarizes. Nobody maintains it by hand. If the spec later changes
enough to need a new review, you write the record again in place, and git
history keeps the old round.

In CI, `spec-md check --require-approved` makes this a merge gate. A spec whose
linked review is still `status: open` fails the check until the sign-off
arrives.
