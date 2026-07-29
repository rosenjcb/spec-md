/**
 * The counter, built from `counter.spec.md`.
 *
 * Deliberately tiny: the point of this example is the behavioral model in the
 * spec (`MOD-1`) and the adapter that lets `spec-md model test` drive this code
 * in lockstep with it — not the counter itself.
 */

export function createCounter({ initialCount = 0 } = {}) {
  let count = initialCount;

  return {
    /** FR-1: increase by one. No upper bound — see TC-2. */
    increment() {
      count += 1;
    },

    /** FR-2: decrease by one, never below zero. */
    decrement() {
      if (count > 0) count -= 1;
    },

    /** FR-3: replace the value. */
    set(value) {
      count = value;
    },

    /** FR-4: back to zero. */
    reset() {
      count = 0;
    },

    /** The current value. */
    value() {
      return count;
    },

    /** FR-5: what a UI would render — a string, as a display is. */
    display() {
      return String(count);
    },
  };
}
