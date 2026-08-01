# Testing in spec.md

This document describes how tests relate to a `*.spec.md` file. The goal is the
same as the goal of the spec: keep intent, behavior, and verification
synchronized, so that humans and agents can trust that the system does what the
spec says.

A `*.spec.md` defines two things that tests care about:

- **Functional Requirements** (`FR-N`) — testable units of behavior.
- **QA Test Cases** (`TC-N`) — executable validation conditions derived from
  those requirements.

The optional `tests` field of the spec points at where those tests live. It is
a YAML list of paths (unit suites, `.http` integration requests, and so on)
relative to the spec file. It is the counterpart to `sources`: `sources` is the
implementation, `tests` is the verification. The conventions below describe what
goes in those files, so that each test traces back to a `TC-N`.

An `FR-N` is the higher-level intent, and **several** `TC-N` rows usually
validate it. A pricing requirement, for example, needs a case for size, one for
quantity, and one for rounding. Each `TC-N`, in turn, can have one test or more.

Tests are how those `TC-N` rows become real. The convention below makes the link
explicit and machine-traceable, and it does not couple you to one test runner.

---

## The convention: tag the test name

Put the **test case tag in brackets** at the start of each test name, then
describe the behavior:

```
[TC-1] Given a valid request, when the store creates the order, then the status is CREATED
```

Two rules; everything else is style:

1. **The tag is a bracketed prefix.** Write `[TC-1]`. Do not use a suffix, and
   do not use bare text.
2. **The tag links to the spec.** `[TC-1]` refers to the `TC-1` row of the
   related `*.spec.md`. That is the whole contract. A reader (or an agent) can
   go from a failed test to the requirement it validates, and back again.

Usually you need only the **test case** tag (`TC-N`). You do not also have to
cite the functional requirement, because the `TC-N` row in the spec already
points at its `FR-N`.

### Why a tag at all

The tag is the join key between the spec and the suite:

- A failed `[TC-4]` tells you which acceptance condition broke.
- An agent that regenerates code from the spec can find, update, or add the
  tests for a given `TC-N`.
- Coverage of the spec is greppable: each `TC-N` in the spec must have one
  `[TC-N]` test or more.

If a test verifies behavior that has no test case yet, that is a signal to add
the `TC-N` row to the spec. For a check that is not an acceptance criterion,
such as a health probe, use a non-spec tag such as `[smoke]`.

---

## Naming style: Gherkin is suggested, not required

We suggest **Given / When / Then** ("Gherkin") phrasing, because it makes each
test name its precondition, its action, and its expected outcome — the same
shape as a QA Test Case:

```
[TC-2] Given a large item and a small item, when the store creates the order, then the total includes the size and the quantity
```

`then` and `should` are interchangeable:

```
[TC-1] Given a placed order, when the system processes it, should return a receipt
```

This is a recommendation. A plain descriptive name is also correct, because
**the tag is the part that matters**. The tag is what links back to the spec:

```
[TC-5] returns 404 for an unknown order id
```

Write the name in [Simplified Technical English](./README.md#the-language), the
same as the spec row it proves: active voice, plain words, and the same term for
the same thing. "When the store creates the order" names the actor; "when the
order is created" hides it. A test name is the sentence a person reads first
when the build goes red, so it must have one meaning only.

---

## Unit tests

Unit tests validate `FR-N` behavior at the function or module level, and carry
the tag of the `TC-N` they support. They must be fast and isolated, and they
must not do I/O.

```ts
// test/orders.test.ts
it("[TC-4] Given a request with no customerId, when the store creates the order, then it throws a ValidationError", () => {
  expect(() => store.create({ customerId: "", items: [...] })).toThrow(ValidationError);
});
```

One `TC-N` can have several unit tests. `TC-4` validation, for example, has one
test for each invalid input. That is expected: many tests, one tag.

## Integration tests

Integration tests exercise the system across a real boundary — an HTTP socket, a
database, a queue — and assert the observable contract. In the reference example
they are `.http` requests (IntelliJ HTTP Client or httpyac) under `http/`, where
the description of the assertion carries the same tag:

```
### Create an order
POST {{host}}/orders
Content-Type: application/json

{ "customerId": "cust-1", "items": [ ... ] }

> {%
client.test("[TC-1] Given a valid request, when the client posts to /orders, then the API creates the order", function () {
  client.assert(response.status === 201, "expected 201");
});
%}
```

The same `TC-N` can appear in a unit test and in an integration test. One proves
the logic, the other proves the wiring. Both point at the same spec row.

---

## Verify

`npx @rosenjcb/spec-md check` reports tag coverage and verifies that the `TC-N`
and `FR-N` ids are contiguous. The join key is the bracketed `[TC-N]` prefix,
described above.

Worked example: [`examples/pizza-ts`](./examples/pizza-ts) —
[`order.spec.md`](./examples/pizza-ts/specs/order.spec.md) with `TC-1..TC-9`,
tagged unit tests in `test/`, and tagged `.http` requests in `http/`.
