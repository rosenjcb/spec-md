import { createCounter } from "../src/counter.mjs";

/**
 * Conformance adapter for `MOD-1 Counter`.
 *
 * It is the whole bridge between the model and the implementation:
 *
 *   init(state)      put the implementation in the model's initial state
 *   actions[AC-N]    perform the model's action on the implementation
 *   observe(handle)  report the implementation's state in the model's shape
 *
 * `spec-md model test` generates the initial states and action sequences,
 * performs each action on both sides, and compares what it observes with what
 * the model predicted. Note that `observe` *translates*: the model's `display`
 * is an integer, while the implementation renders a string. Bridging that
 * mismatch is the adapter's job, not the model's.
 */
export default {
  init({ count }) {
    return createCounter({ initialCount: count });
  },

  actions: {
    "AC-1": (counter) => counter.increment(),
    "AC-2": (counter) => counter.decrement(),
    "AC-3": (counter, { value }) => counter.set(value),
    "AC-4": (counter) => counter.reset(),
  },

  observe(counter) {
    return { count: counter.value(), display: Number(counter.display()) };
  },
};
