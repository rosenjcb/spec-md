---
type: Spec
title: "Spec: Counter"
sources: [./src]
tests: [./test]
description: The specification for the Counter domain, with an executable behavioral model
tags: [counter, example, model, conformance]
timestamp: 2026-07-29T00:00:00Z
---

### Intro

The Counter holds a single non-negative integer and exposes four operations that
change it: increment, decrement, set, and reset. It is the system of record for
that value; a display derived from it is what a user sees.

This example exists to demonstrate the **behavioral model** layer. The
`FR-N` rows say what the counter should do in prose, the `TC-N` rows pin
specific examples, and `MOD-1` states the same contract precisely enough to
execute — so an implementation change that quietly redefines behavior fails
`spec-md model test` instead of passing a green test suite.

### Definitions

- Counter: The stored integer value (`count`).
- Display: The rendered form of the counter, as a user would read it.
- Increment / Decrement: Single-step changes to the counter.
- Set: Replacement of the counter with a supplied value.
- Reset: Return of the counter to zero.

### Scope

## In Scope
- Increment, decrement, set, and reset the counter
- Keep the counter non-negative
- Derive a display from the counter

## Out of Scope
- Persistence across processes
- Concurrency and multi-user editing
- Any upper bound on the counter (see `TC-2`)
- Rendering, styling, and input handling

### Functional Requirements

| ID   | Requirement |
|------|-------------|
| FR-1 | Incrementing increases the counter by one |
| FR-2 | Decrementing decreases the counter by one, and never takes it below zero |
| FR-3 | Setting the counter replaces its value with the value supplied |
| FR-4 | Resetting returns the counter to zero |
| FR-5 | The display shows the current value of the counter |

### QA Test Cases

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|-------------|----------|------------------|
| TC-1 | FR-1 | Counter at 0, incremented | Counter is 1 |
| TC-2 | FR-1, AC-1 | Counter at 100, incremented | Counter is 101 — the counter has no maximum |
| TC-3 | FR-2 | Counter at 1, decremented | Counter is 0 |
| TC-4 | FR-2 | Counter at 0, decremented | Counter stays 0 |
| TC-5 | FR-3 | Counter at 0, set to 42 | Counter is 42 |
| TC-6 | FR-4 | Counter at 7, reset | Counter is 0 |
| TC-7 | FR-5 | Counter at 3 | Display reads 3 |

### Behavioral Model

The transition model is the primary artifact: it defines what each operation
does, so `spec-md model check` can explore state and action combinations nobody
thought to name. `INV-N` and `BP-N` are additional claims about that model.

`in 0..100` is an exploration bound, not a requirement — it says which starting
values to try and where the walk stops expanding. `TC-2` is the reason it is not
an invariant: incrementing at 100 must yield 101.

```spec-model
model: MOD-1 Counter
adapter: ./model/counter.adapter.mjs

state:
  count: integer in 0..100 = 0

derived:
  display: count

AC-1 Increment:
  requirement: FR-1
  count' = count + 1

AC-2 Decrement:
  requirement: FR-2
  requires: count > 0
  count' = count - 1

AC-3 Set(value: integer in 0..100):
  requirement: FR-3
  count' = value

AC-4 Reset:
  requirement: FR-4
  count' = 0

INV-1 The counter is never negative:
  requirement: FR-2
  check: count >= 0

INV-2 The display mirrors the counter:
  requirement: FR-5
  check: display = count

BP-1 Increment changes the counter by exactly one:
  requirement: FR-1
  check: after AC-1, count = count@pre + 1

BP-2 Increment and Decrement are inverses:
  requirement: FR-1, FR-2
  check: AC-1 then AC-2 preserves count

BP-3 Setting stores exactly the value supplied:
  requirement: FR-3
  check: after AC-3, count = value

BP-4 Reset clears the counter:
  requirement: FR-4
  check: after AC-4, count = 0
```
