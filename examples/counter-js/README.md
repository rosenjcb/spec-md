# counter-js — the behavioral model layer

A deliberately tiny example whose subject is not the counter but the layer above
it: an **executable behavioral model**, and what it catches that a test suite
cannot.

Zero dependencies. Node ≥ 18.

```text
counter.spec.md          FR-1..FR-5, TC-1..TC-7, and MOD-1 (the model)
src/counter.mjs          the implementation
model/counter.adapter.mjs the bridge between MOD-1 and the implementation
test/counter.test.mjs    [TC-N]-tagged unit tests
```

## Run it

```bash
node --test                                  # the [TC-N] unit tests
npx @rosenjcb/spec-md check . --strict       # lint + coverage + model check
npx @rosenjcb/spec-md model list .           # the contract, laid out
npx @rosenjcb/spec-md model check .          # explore the model on its own
npx @rosenjcb/spec-md model test .           # conformance: implementation vs. model
```

From the repository root, using this checkout of the CLI:

```bash
node cli/bin/spec-md.js model test examples/counter-js
```

```text
✓ MOD-1 Counter examples/counter-js/counter.spec.md
  200 trace(s), 476 action(s), 676 observation(s) conform

✓ 1 model(s) conform, 0 failure(s)
```

## What the model catches that the tests do not

Seven unit tests cover the seven examples someone thought to write. Introduce a
bug that is locally reasonable but globally inconsistent — `increment` reading a
cached value that `reset` forgets to clear:

```js
let count = initialCount;
let cached = initialCount;

increment() { count = cached + 1; cached = count; }
set(value)  { count = value; cached = value; }
reset()     { count = 0; }               // forgot: cached is now stale
```

Every unit test still passes: none of them resets and *then* increments.
`spec-md model test` generates that sequence and reports it:

```text
Behavioral conformance failed

Spec: Counter
Model: MOD-1 Counter

Minimal counterexample:
  Initial state: count = 100, display = 100
  Trace:
    1. AC-4 Reset → count = 0
    2. AC-1 Increment → count = 1

Expected:
  count = 1
  display = 1

Observed:
  count = 101
  display = 101

Relevant contract:
  FR-1: Incrementing increases the counter by one
  AC-1: count' = count + 1

Possible resolutions:
  - Restore implementation behavior so it still follows AC-1
  - Update FR-1 and AC-1 to define the new behavior, then add the QA Test Case that pins the boundary
```

Tests protect examples. The model protects behavior.

The full language and adapter reference: [MODELS.md](../../MODELS.md).
