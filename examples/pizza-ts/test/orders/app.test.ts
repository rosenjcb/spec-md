import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";

/**
 * HTTP-level tests that exercise the Express app over a real socket using
 * the built-in fetch. The `.http` files under `http/` cover the same routes
 * for manual / IntelliJ / httpyac runs. Tags ([TC-N]) link to
 * specs/order.spec.md.
 */
describe("pizza-ts HTTP API", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it("[TC-2] Given a running server, when GET /menu, then the catalogue is returned", async () => {
    const res = await fetch(`${baseUrl}/menu`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("[TC-1] Given a valid request, when POST /orders then GET /orders/:id, then the order is created and read back", async () => {
    const create = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: "cust-1",
        items: [{ pizzaId: "pepperoni", size: "large", quantity: 2 }],
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string; total: number };
    expect(created.total).toBe(3520);

    const read = await fetch(`${baseUrl}/orders/${created.id}`);
    expect(read.status).toBe(200);
    const fetched = (await read.json()) as { id: string };
    expect(fetched.id).toBe(created.id);
  });

  it("[TC-6] Given an invalid request, when POST /orders, then 400 is returned", async () => {
    const res = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId: "", items: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("[TC-9] Given an unknown id, when GET /orders/:id, then 404 is returned", async () => {
    const res = await fetch(`${baseUrl}/orders/nope`);
    expect(res.status).toBe(404);
  });
});
