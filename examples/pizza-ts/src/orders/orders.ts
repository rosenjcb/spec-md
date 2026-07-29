import { randomUUID } from "node:crypto";
import { findMenuItem, unitPriceFor } from "./menu.ts";
import { SIZES } from "./types.ts";
import type {
  CreateOrderRequest,
  Order,
  OrderItem,
  OrderItemInput,
} from "./types.ts";

/** Raised when a create-order request fails validation (FR-1, FR-4). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * In-memory order store. The example keeps orders for the life of the
 * process; persistence is Out of Scope per the spec.
 */
export class OrderStore {
  private readonly orders = new Map<string, Order>();

  /**
   * Validate, price, and persist an order (FR-1, FR-2, FR-4).
   * The returned order is immutable from the caller's perspective (FR-3).
   */
  create(request: CreateOrderRequest): Order {
    const customerId = request?.customerId?.trim();
    if (!customerId) {
      throw new ValidationError("customerId is required");
    }

    if (!Array.isArray(request.items) || request.items.length === 0) {
      throw new ValidationError("order must contain at least one item");
    }

    const items = request.items.map((input) => priceItem(input));

    const total = items.reduce((sum, item) => sum + item.lineTotal, 0);

    const order: Order = {
      id: randomUUID(),
      customerId,
      items,
      total,
      status: "CREATED",
      placedAt: new Date().toISOString(),
    };

    // Store a structurally cloned copy so callers cannot mutate state.
    this.orders.set(order.id, structuredClone(order));
    return structuredClone(order);
  }

  get(id: string): Order | undefined {
    const order = this.orders.get(id);
    return order ? structuredClone(order) : undefined;
  }
}

/** Validate a single line item and attach pricing (FR-2). */
function priceItem(input: OrderItemInput): OrderItem {
  const item = findMenuItem(input?.pizzaId);
  if (!item) {
    throw new ValidationError(`unknown pizza: ${input?.pizzaId}`);
  }

  if (!SIZES.includes(input.size)) {
    throw new ValidationError(`invalid size: ${input.size}`);
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new ValidationError("quantity must be a positive integer");
  }

  const unitPrice = unitPriceFor(item, input.size);
  return {
    pizzaId: item.id,
    name: item.name,
    size: input.size,
    quantity: input.quantity,
    unitPrice,
    lineTotal: unitPrice * input.quantity,
  };
}
