import { findMenuItem, unitPriceFor, SIZE_MULTIPLIER } from "../src/orders/menu.ts";
import { OrderStore } from "../src/orders/orders.ts";

/**
 * Conformance adapter for `MOD-1 Orders` in `specs/order.spec.md`.
 *
 * It is the whole bridge between the model and the implementation:
 *
 *   init(state)      put the implementation in the model's initial state
 *   actions[AC-N]    perform the model's action on the implementation
 *   observe(handle)  report the implementation's state in the model's shape
 *
 * `spec-md model test` generates the action sequences, performs each one on both
 * sides, and compares what it observes with what the model predicted.
 *
 * Two things worth noticing, because they are the adapter's real job:
 *
 * 1. **Translation.** The model works in size *multipliers* and a single base
 *    price; the implementation works in pizza ids and size names. Mapping one
 *    onto the other belongs here so the model can stay an abstraction.
 * 2. **Only what is observable.** `OrderStore` is atomic — an order is priced
 *    when it is created — so before `AC-2 PlaceOrder` there is no total to read.
 *    `observe` omits `total` until then, and the runner compares only the keys
 *    it is given. The accumulated prediction is checked in full the moment the
 *    order lands in the store.
 *
 * This example needs a Node that strips TypeScript types (≥ 22.18) because the
 * adapter imports `src/*.ts` directly. A project without one points its adapter
 * at compiled output instead.
 */

const PIZZA_ID = "margherita";
const CUSTOMER_ID = "cust-model";

/** The model's `sizeMultiplier` names a size; the menu is the authority on which. */
const sizeFor = (multiplier) =>
  Object.keys(SIZE_MULTIPLIER).find((size) => SIZE_MULTIPLIER[size] === multiplier);

export default {
  init({ status, lineCount, total }) {
    // Only the empty draft is realizable: an OrderStore has no way to start
    // holding a half-priced order. INV-1 and INV-2 keep the generated initial
    // states down to exactly that one, so this is a guard, not a limitation.
    if (status !== "draft" || lineCount !== 0 || total !== 0) {
      throw new Error(
        `cannot realize initial state (status=${status}, lineCount=${lineCount}, total=${total})`,
      );
    }
    return { store: new OrderStore(), draft: [], orderId: null };
  },

  actions: {
    "AC-1": (app, { sizeMultiplier, quantity }) => {
      const size = sizeFor(sizeMultiplier);
      if (!size) throw new Error(`no menu size has multiplier ${sizeMultiplier}`);
      app.draft.push({ pizzaId: PIZZA_ID, size, quantity });
    },

    "AC-2": (app) => {
      const order = app.store.create({ customerId: CUSTOMER_ID, items: app.draft });
      app.orderId = order.id;
    },
  },

  observe(app) {
    const state = {
      // The model's `basePrice` is a claim about the menu (FR-2, TC-2).
      basePrice: unitPriceFor(findMenuItem(PIZZA_ID), "small"),
      status: app.orderId ? "created" : "draft",
      placed: app.orderId !== null,
    };
    if (!app.orderId) {
      state.lineCount = app.draft.length;
      return state; // `total` is not observable until the order is priced.
    }
    // Read back what was persisted, not what `create` returned (FR-3, FR-5).
    const order = app.store.get(app.orderId);
    state.lineCount = order.items.length;
    state.total = order.total;
    return state;
  },
};
