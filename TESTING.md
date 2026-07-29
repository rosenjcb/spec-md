# Testing in spec.md

This document describes how tests relate to a `*.spec.md` file. The goal is the
same as the spec itself: keep intent, behavior, and verification synchronized so
both humans and agents can trust that the system does what the spec says.

A `*.spec.md` defines two things that tests care about:

- **Functional Requirements** (`FR-N`) — testable units of behavior.
- **QA Test Cases** (`TC-N`) — executable validation conditions derived from
  those requirements.

The spec's optional `tests` field points at where those tests live — a YAML
list of paths (unit suites, `.http` integration requests, and so on) relative
to the spec file itself. It is the counterpart to `sources`:
`sources` is the implementation, `tests` is the verification. The conventions
below describe what goes in those files so each test traces back to a `TC-N`.

An `FR-N` is the higher-level intent; it is typically validated by **several**
`TC-N`s (e.g. a pricing requirement covered by cases for size, quantity, and
rounding). Each `TC-N`, in turn, may have one or more tests.

Tests are how those `TC-N` rows become real. The convention below makes the link
explicit and machine-traceable, without coupling you to any one test runner.

---

## The convention: tag the test name

Prefix each test name with the **test case tag in brackets**, then describe the
behavior:

```
[TC-1] Given a valid request, when the order is created, then status is CREATED
```

Two rules, everything else is style:

1. **The tag is a bracketed prefix.** `[TC-1]`, not a suffix, not bare text.
2. **The tag links to the spec.** `[TC-1]` refers to the `TC-1` row of the
   relevant `*.spec.md`. That is the whole contract — a reader (or an agent)
   can jump from a failing test straight to the requirement it validates, and
   back.

You generally only need the **test case** tag (`TC-N`). You do not have to also
cite the functional requirement — the `TC-N` row in the spec already points at
its `FR-N`.

### Why a tag at all

The tag is the join key between the spec and the suite:

- A failing `[TC-4]` tells you exactly which acceptance condition broke.
- An agent regenerating code from the spec can find, update, or add the tests
  for a given `TC-N`.
- Coverage of the spec becomes greppable: every `TC-N` in the spec should have
  at least one `[TC-N]` test.

If a test verifies behavior that has no test case yet, that is a signal to add
the `TC-N` to the spec — or use a non-spec tag such as `[smoke]` for things like
health checks that aren't acceptance criteria.

---

## Naming style: Gherkin is suggested, not required

We suggest **Given / When / Then** ("Gherkin") phrasing because it forces each
test to name its precondition, action, and expected outcome — the same shape as
a QA Test Case:

```
[TC-2] Given large and small items, when the order is created, then the total reflects size and quantity
```

`then` and `should` are interchangeable:

```
[TC-1] Given an order is placed, when it is processed, should return a receipt
```

This is a recommendation. A plain descriptive name is fine too — **the tag is
the part that matters**, because the tag is what links back to the spec:

```
[TC-5] returns 404 for an unknown order id
```

---

## Unit tests

Unit tests validate `FR-N` behavior at the function or module level, tagged with
the `TC-N` they support. They should be fast, isolated, and free of I/O.

```ts
// test/orders.test.ts
it("[TC-4] Given a request without a customerId, when the order is created, then a ValidationError is thrown", () => {
  expect(() => store.create({ customerId: "", items: [...] })).toThrow(ValidationError);
});
```

A single `TC-N` may have several unit tests (e.g. `TC-4` validation has one per
invalid input). That is expected — many tests, one tag.

## Integration tests

Integration tests exercise the system across a real boundary — an HTTP socket, a
database, a queue — and assert the observable contract. In the reference example
these live as `.http` requests (IntelliJ HTTP Client / httpyac) under `http/`,
where the assertion description carries the same tag:

```
### Create an order
POST {{host}}/orders
Content-Type: application/json

{ "customerId": "cust-1", "items": [ ... ] }

> {%
client.test("[TC-1] Given a valid request, when POST /orders, then the order is created", function () {
  client.assert(response.status === 201, "expected 201");
});
%}
```

The same `TC-N` can appear in both a unit test and an integration test — one
proves the logic, the other proves the wiring. Both point at the same spec row.

---

## Beyond examples: the behavioral model

Everything above is about **examples** — the cases someone thought to write.
That is what a `TC-N` row is for, and it is where most of the value lives.

It has a known ceiling: a suite can pass while behavior has silently changed,
because nothing checked the combinations nobody wrote down. When a domain has
state that changes over time and behavior worth protecting mechanically, a spec
can add an executable **behavioral model** — state, actions (`AC-N`), invariants
(`INV-N`), properties (`BP-N`) — that `spec-md model check` explores and
`spec-md model test` conformance-tests against the implementation.

Tests protect examples. Models protect behavior. The two are complements, and a
`TC-N` row may cite the model element it exercises:

```md
| TC-4 | FR-2, AC-1 | Order with several line items | Total sums each line |
```

The layer is optional and fully specified in **[MODELS.md](./MODELS.md)**.

---

## Verify

`npx @rosenjcb/spec-md check` covers tag coverage, contiguous `TC-N` / `FR-N`
order, and (where a spec has one) the behavioral model. The join key is the
bracketed `[TC-N]` prefix — see above.

Worked example: [`examples/pizza-ts`](./examples/pizza-ts) —
[`order.spec.md`](./examples/pizza-ts/specs/order.spec.md) with `TC-1..TC-9`,
tagged unit tests in `test/`, tagged `.http` requests in `http/`, and a
behavioral model over the ordering lifecycle conformance-tested through
`model/orders.adapter.mjs`.
