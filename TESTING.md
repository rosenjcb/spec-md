# Testing in spec-md

This document describes how tests relate to a `*.spec.md` file. The goal is the
same as the goal of the spec: keep intent, behavior, and verification
synchronized, so that humans and agents can trust that the system does what the
spec says.

A `*.spec.md` defines two things that tests care about:

- **Functional Requirements** (`FR-N`) — testable units of behavior.
- **QA Test Cases** (`TC-XXXX`) — executable validation conditions derived
  from those requirements. Each Test ID is a **stable opaque join key**, not a
  sequence number.

The optional `tests` field of the spec points at where those tests live. It is
a YAML list of paths (unit suites, `.http` integration requests, and so on)
relative to the spec file. It is the counterpart to `sources`: `sources` is the
implementation, `tests` is the verification. The conventions below describe what
goes in those files, so that each test traces back to a Test ID.

An `FR-N` is the higher-level intent, and **several** test-case rows usually
validate it. A pricing requirement, for example, needs a case for size, one for
quantity, and one for rounding. Each Test ID, in turn, can have one test or more.

Tests are how those rows become real. The convention below makes the link
explicit and machine-traceable, and it does not couple you to one test runner.

---

## The convention: tag the test name

Put the **test case tag in brackets** at the start of each test name, then
describe the behavior:

```
[TC-K7MF] Given a valid request, when the store creates the order, then the status is CREATED
```

Two rules; everything else is style:

1. **The tag is a bracketed prefix.** Write `[TC-K7MF]`. Do not use a suffix,
   and do not use bare text.
2. **The tag links to the spec.** `[TC-K7MF]` refers to the `TC-K7MF` row of
   the related `*.spec.md`. That is the whole contract. A reader (or an agent)
   can go from a failed test to the requirement it validates, and back again.

Usually you need only the **test case** tag. You do not also have to cite the
functional requirement, because the TC row in the spec already points at its
`FR-N`.

### Why a tag at all

The tag is the join key between the spec and the suite:

- A failed `[TC-ZFJF]` tells you which acceptance condition broke.
- An agent that regenerates code from the spec can find, update, or add the
  tests for a given Test ID.
- Coverage of the spec is greppable: each Test ID in the spec must have one
  `[TC-XXXX]` test or more.

If a test verifies behavior that has no test case yet, that is a signal to add
the TC row to the spec (generate a new id with `spec-md id`). For a check that
is not an acceptance criterion, such as a health probe, use a non-spec tag
such as `[smoke]`.

### Stable identity

A Test ID does **not** encode row position. When you remove a case, other ids
stay put. When you insert a case, generate a **new** id — do not shift numbers.
When you edit scenario text, keep the same id. Migrate legacy `TC-1` tables with
`spec-md migrate-ids` once rather than hand-editing join keys.

---

## Naming style: Gherkin is suggested, not required

We suggest **Given / When / Then** ("Gherkin") phrasing, because it makes each
test name its precondition, its action, and its expected outcome — the same
shape as a QA Test Case:

```
[TC-0QQE] Given a large item and a small item, when the store creates the order, then the total includes the size and the quantity
```

`then` and `should` are interchangeable:

```
[TC-5B8L] Given a placed order, when the system processes it, should return a receipt
```

This is a recommendation. A plain descriptive name is also correct, because
**the tag is the part that matters**. The tag is what links back to the spec:

```
[TC-JKUK] returns 404 for an unknown order id
```

Write the name in [Simplified Technical English](./README.md#the-language), the
same as the spec row it proves: active voice, plain words, and the same term for
the same thing. "When the store creates the order" names the actor; "when the
order is created" hides it. A test name is the sentence a person reads first
when the build goes red, so it must have one meaning only.

---

## Unit tests

Unit tests validate `FR-N` behavior at the function or module level, and carry
the tag of the Test ID they support. They must be fast and isolated, and they
must not do I/O.

```ts
// test/orders.test.ts
it("[TC-ZFJF] Given a request with no customerId, when the store creates the order, then it throws a ValidationError", () => {
  expect(() => store.create({ customerId: "", items: [...] })).toThrow(ValidationError);
});
```

One Test ID can have several unit tests. Validation, for example, often has one
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
client.test("[TC-5B8L] Given a valid request, when the client posts to /orders, then the API creates the order", function () {
  client.assert(response.status === 201, "expected 201");
});
%}
```

The same Test ID can appear in a unit test and in an integration test. One
proves the logic, the other proves the wiring. Both point at the same spec row.

---

## Verify

`npx @rosenjcb/spec-md check` reports tag coverage and verifies that FR ids are
contiguous and that Test IDs use the stable `TC-XXXX` format. The join key is
the bracketed `[TC-XXXX]` prefix, described above.

Worked example: [`examples/pizza-ts`](./examples/pizza-ts) —
[`order.spec.md`](./examples/pizza-ts/specs/order.spec.md) with nine stable
Test IDs, tagged unit tests in `test/`, and tagged `.http` requests in `http/`.
