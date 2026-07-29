---
type: Spec
title: "Spec: Pizza Orders"
sources: [../src/orders, ../src/app.ts]
tests: [../test/orders, ../http/orders.http]
description: The specification for the Orders domain in the pizza-ts example platform
resource: https://notion.com/read_only_publish_page_location
review: ./order.review.md
tags: [pizza, orders, checkout]
timestamp: 2026-07-09T00:00:00Z
---

### Intro

The Orders system handles creation and retrieval of customer pizza orders.

It is the system of record for placed orders. An order is created from a
validated request, priced from the menu, and stored immutably. Downstream
concerns such as payment, kitchen routing, and delivery consume orders but are
not produced here.

Once created, an order is immutable except through explicit cancellation or
adjustment flows (Out of Scope for this example).

### Definitions

- Order: A placed pizza purchase, identified by `id`.
- Customer: The user who placed the order (`customerId`).
- Menu Item: A pizza available for purchase, with a `basePrice` in cents.
- Size: One of `small`, `medium`, `large`; scales the unit price.
- Order Item: A single line on an order (pizza + size + quantity), priced.
- Order Total: Sum of all line totals, in cents.
- Placed At: Timestamp when the order is committed (ISO 8601).
- Status: Lifecycle state of the order (CREATED, PAID, FULFILLED, CANCELLED).

### Scope

## In Scope
- Expose the pizza menu and per-size pricing
- Create orders from validated requests
- Price line items from the menu and size multipliers
- Compute the order total from line items
- Persist immutable order records for the process lifetime
- Retrieve an order by id

## Out of Scope
- Payment authorization and capture
- Inventory and stock management
- Delivery, dispatch, and kitchen routing
- Durable persistence (database)
- Authentication and authorization

### Functional Requirements

| ID   | Requirement |
|------|------------|
| FR-1 | Create an order from a request with a customer and at least one item |
| FR-2 | Compute line and order totals from menu price and size multiplier |
| FR-3 | Prevent modification of an order after creation |
| FR-4 | Reject requests missing a customer, items, or with invalid items |
| FR-5 | Retrieve a previously created order by its id |

### QA Test Cases

A requirement is a higher-level statement, validated by **one or more** test
cases. Here `FR-2` (pricing) owns `TC-2` through `TC-4`, and `FR-4`
(validation) owns `TC-6` through `TC-8`.

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|------------|----------|------------------|
| TC-1 | FR-1 | Valid request submitted | Order created with status CREATED |
| TC-2 | FR-2 | Small pizza priced | Unit price equals the base price |
| TC-3 | FR-2 | Larger size priced | Unit price scaled by the size multiplier, rounded |
| TC-4 | FR-2 | Order with several line items | Total sums each line (unit price × quantity) |
| TC-5 | FR-3 | Mutate returned order object | Stored order is unchanged |
| TC-6 | FR-4 | Missing customerId | 400 validation error |
| TC-7 | FR-4 | Empty items list | 400 validation error |
| TC-8 | FR-4 | Unknown pizza or non-positive quantity | 400 validation error |
| TC-9 | FR-5 | Fetch existing / unknown id | 200 with order / 404 not found |

### Behavioral Model

The executable contract for the ordering lifecycle. It is an **abstraction** of
the implementation, not a copy: the model tracks how many lines have been priced,
the running total in cents, and whether the order has been placed. `basePrice` is
the Margherita's `small` price from the menu (see Definitions), which is what
makes `BP-1` state the pricing rule of `FR-2` rather than restate it.

The domains (`0..3` lines, `0..20000` cents) bound the exploration, not the
system. `spec-md model check` walks the model on its own; `spec-md model test`
replays the same action sequences against `OrderStore` through
[`../model/orders.adapter.mjs`](../model/orders.adapter.mjs) and compares every
observation with the model's prediction.

Two parts of this spec stay outside the model on purpose. `FR-4` (rejecting
invalid requests) is a guard on the boundary rather than a state transition, and
the aliasing half of `FR-3` — mutating a returned object — is not expressible in
a state model. `TC-5` through `TC-8` remain the proof for both.

```spec-model
model: MOD-1 Orders
adapter: ../model/orders.adapter.mjs

state:
  status: string in [draft, created] = draft
  lineCount: integer in 0..3 = 0
  total: integer in 0..20000 = 0
  basePrice: integer = 900

derived:
  placed: status = created

AC-1 AddItem(sizeMultiplier: number in [1, 1.3, 1.6], quantity: integer in 1..2):
  requirement: FR-2
  requires: status = draft
  lineCount' = lineCount + 1
  total' = total + round(basePrice * sizeMultiplier) * quantity

AC-2 PlaceOrder:
  requirement: FR-1
  requires: status = draft and lineCount > 0
  status' = created

INV-1 A placed order has at least one priced line:
  requirement: FR-1
  check: status = created implies lineCount > 0

INV-2 Lines and a total appear together:
  requirement: FR-2
  check: (lineCount = 0) = (total = 0)

BP-1 Each line adds its rounded unit price times quantity to the total:
  requirement: FR-2
  check: after AC-1, total = total@pre + round(basePrice * sizeMultiplier) * quantity

BP-2 Placing an order does not change what was priced:
  requirement: FR-3
  check: after AC-2, total = total@pre and lineCount = lineCount@pre
```
