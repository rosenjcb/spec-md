import { beforeEach, describe, expect, it } from "vitest";
import { OrderStore, ValidationError } from "../../src/orders/orders.js";

// Tags ([TC-N]) link each case to a QA Test Case in specs/order.spec.md.
describe("OrderStore", () => {
  let store: OrderStore;

  beforeEach(() => {
    store = new OrderStore();
  });

  it("[TC-1] Given a valid request, when the store creates the order, then the status is CREATED", () => {
    const order = store.create({
      customerId: "cust-1",
      items: [{ pizzaId: "pepperoni", size: "large", quantity: 2 }],
    });

    expect(order.id).toBeTypeOf("string");
    expect(order.status).toBe("CREATED");
    expect(order.placedAt).toBeTypeOf("string");
  });

  it("[TC-4] Given a large item and a small item, when the store creates the order, then the total includes the size and the quantity", () => {
    const order = store.create({
      customerId: "cust-1",
      items: [
        { pizzaId: "pepperoni", size: "large", quantity: 2 }, // 1760 * 2
        { pizzaId: "margherita", size: "small", quantity: 1 }, // 900
      ],
    });

    expect(order.items[0]!.lineTotal).toBe(3520);
    expect(order.total).toBe(4420);
  });

  it("[TC-5] Given a created order, when the caller changes the returned object, then the stored order does not change", () => {
    const created = store.create({
      customerId: "cust-1",
      items: [{ pizzaId: "veggie", size: "medium", quantity: 1 }],
    });

    created.total = 0;
    created.items[0]!.quantity = 99;

    const fetched = store.get(created.id)!;
    expect(fetched.total).toBe(1560); // 1200 * 1.3
    expect(fetched.items[0]!.quantity).toBe(1);
  });

  it("[TC-6] Given a request with no customerId, when the store creates the order, then it throws a ValidationError", () => {
    expect(() =>
      store.create({
        customerId: "",
        items: [{ pizzaId: "margherita", size: "small", quantity: 1 }],
      }),
    ).toThrow(ValidationError);
  });

  it("[TC-7] Given an empty items list, when the store creates the order, then it throws a ValidationError", () => {
    expect(() => store.create({ customerId: "cust-1", items: [] })).toThrow(
      ValidationError,
    );
  });

  it("[TC-8] Given an unknown pizza, when the store creates the order, then it throws a ValidationError", () => {
    expect(() =>
      store.create({
        customerId: "cust-1",
        items: [{ pizzaId: "anchovy-surprise", size: "small", quantity: 1 }],
      }),
    ).toThrow(/unknown pizza/);
  });

  it("[TC-8] Given a quantity of zero, when the store creates the order, then it throws a ValidationError", () => {
    expect(() =>
      store.create({
        customerId: "cust-1",
        items: [{ pizzaId: "margherita", size: "small", quantity: 0 }],
      }),
    ).toThrow(/quantity/);
  });

  it("[TC-9] Given an unknown id, when the store gets the order, then it returns undefined", () => {
    expect(store.get("does-not-exist")).toBeUndefined();
  });
});
