import test from "node:test";
import assert from "node:assert/strict";
import { createCounter } from "../src/counter.mjs";

/**
 * Concrete test cases from `counter.spec.md`. Each name carries the `[TC-N]`
 * tag that links it back to the spec row it proves — the join key
 * `spec-md coverage` greps for.
 *
 * These cover the examples someone thought to write. The behavioral model
 * (`MOD-1`) covers the combinations nobody did: `spec-md model test` drives
 * the same implementation through generated action sequences.
 */

test("[TC-1] Given a counter at 0, when it is incremented, then the counter is 1", () => {
  const counter = createCounter();
  counter.increment();
  assert.equal(counter.value(), 1);
});

test("[TC-2] Given a counter at 100, when it is incremented, then the counter is 101", () => {
  const counter = createCounter({ initialCount: 100 });
  counter.increment();
  assert.equal(counter.value(), 101);
});

test("[TC-3] Given a counter at 1, when it is decremented, then the counter is 0", () => {
  const counter = createCounter({ initialCount: 1 });
  counter.decrement();
  assert.equal(counter.value(), 0);
});

test("[TC-4] Given a counter at 0, when it is decremented, then the counter stays 0", () => {
  const counter = createCounter();
  counter.decrement();
  assert.equal(counter.value(), 0);
});

test("[TC-5] Given a counter at 0, when it is set to 42, then the counter is 42", () => {
  const counter = createCounter();
  counter.set(42);
  assert.equal(counter.value(), 42);
});

test("[TC-6] Given a counter at 7, when it is reset, then the counter is 0", () => {
  const counter = createCounter({ initialCount: 7 });
  counter.reset();
  assert.equal(counter.value(), 0);
});

test("[TC-7] Given a counter at 3, when the display is read, then it reads 3", () => {
  const counter = createCounter({ initialCount: 3 });
  assert.equal(counter.display(), "3");
});
