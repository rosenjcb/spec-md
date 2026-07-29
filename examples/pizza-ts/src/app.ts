import express, { type Request, type Response } from "express";
import { MENU } from "./orders/menu.ts";
import { OrderStore, ValidationError } from "./orders/orders.ts";

/**
 * Build the Express application. The store is injected so tests can supply
 * a fresh one per case.
 */
export function createApp(store: OrderStore = new OrderStore()) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  // Browse the menu.
  app.get("/menu", (_req: Request, res: Response) => {
    res.json({ items: MENU });
  });

  // Create an order from a validated request (FR-1, FR-2, FR-4).
  app.post("/orders", (req: Request, res: Response) => {
    try {
      const order = store.create(req.body);
      res.status(201).json(order);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Fetch a previously created order.
  app.get("/orders/:id", (req: Request, res: Response) => {
    const order = store.get(req.params.id ?? "");
    if (!order) {
      res.status(404).json({ error: "order not found" });
      return;
    }
    res.json(order);
  });

  return app;
}
