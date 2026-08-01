import { describe, expect, it } from "vitest";
import { MENU, findMenuItem, unitPriceFor } from "../../src/orders/menu.js";

// Tags ([TC-N]) link each case to a QA Test Case in specs/order.spec.md.
describe("menu", () => {
  it("[TC-2] Given the menu, when the code lists it, then it contains one item or more", () => {
    expect(MENU.length).toBeGreaterThan(0);
  });

  it("[TC-2] Given a known pizza id, when the code finds it, then it returns the menu item", () => {
    expect(findMenuItem("margherita")?.name).toBe("Margherita");
  });

  it("[TC-8] Given an unknown pizza id, when the code finds it, then it returns undefined", () => {
    expect(findMenuItem("anchovy-surprise")).toBeUndefined();
  });

  it("[TC-2] Given a small pizza, when the code prices it, then the unit price equals the base price", () => {
    const margherita = findMenuItem("margherita")!;
    expect(unitPriceFor(margherita, "small")).toBe(900);
  });

  it("[TC-3] Given a large size, when the code prices it, then it multiplies the base price and rounds the result", () => {
    const margherita = findMenuItem("margherita")!;
    expect(unitPriceFor(margherita, "medium")).toBe(1170); // 900 * 1.3
    expect(unitPriceFor(margherita, "large")).toBe(1440); // 900 * 1.6
  });
});
