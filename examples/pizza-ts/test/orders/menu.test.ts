import { describe, expect, it } from "vitest";
import { MENU, findMenuItem, unitPriceFor } from "../../src/orders/menu.ts";

// Tags ([TC-N]) link each case to a QA Test Case in specs/order.spec.md.
describe("menu", () => {
  it("[TC-2] Given the menu, when it is listed, then it is non-empty", () => {
    expect(MENU.length).toBeGreaterThan(0);
  });

  it("[TC-2] Given a known pizza id, when it is looked up, then the item is returned", () => {
    expect(findMenuItem("margherita")?.name).toBe("Margherita");
  });

  it("[TC-8] Given an unknown pizza id, when it is looked up, then nothing is returned", () => {
    expect(findMenuItem("anchovy-surprise")).toBeUndefined();
  });

  it("[TC-2] Given a small pizza, when it is priced, then it costs the base price", () => {
    const margherita = findMenuItem("margherita")!;
    expect(unitPriceFor(margherita, "small")).toBe(900);
  });

  it("[TC-3] Given a larger size, when it is priced, then the base price is scaled and rounded", () => {
    const margherita = findMenuItem("margherita")!;
    expect(unitPriceFor(margherita, "medium")).toBe(1170); // 900 * 1.3
    expect(unitPriceFor(margherita, "large")).toBe(1440); // 900 * 1.6
  });
});
