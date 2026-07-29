import type { MenuItem, Size } from "./types.ts";

/**
 * The pizza menu. Prices are the `small` price in cents (FR-2).
 *
 * In a real system this would live in a database; here it is a static
 * catalogue so the example stays dependency-free.
 */
export const MENU: readonly MenuItem[] = [
  { id: "margherita", name: "Margherita", basePrice: 900 },
  { id: "pepperoni", name: "Pepperoni", basePrice: 1100 },
  { id: "veggie", name: "Veggie Supreme", basePrice: 1200 },
  { id: "hawaiian", name: "Hawaiian", basePrice: 1150 },
] as const;

/** Multiplier applied to `basePrice` for each size (FR-2). */
export const SIZE_MULTIPLIER: Record<Size, number> = {
  small: 1,
  medium: 1.3,
  large: 1.6,
};

export function findMenuItem(pizzaId: string): MenuItem | undefined {
  return MENU.find((item) => item.id === pizzaId);
}

/**
 * Compute the unit price (in cents) for a pizza at a given size.
 * Rounds to the nearest cent so totals stay integral.
 */
export function unitPriceFor(item: MenuItem, size: Size): number {
  return Math.round(item.basePrice * SIZE_MULTIPLIER[size]);
}
