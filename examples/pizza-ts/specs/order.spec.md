---
type: Spec
title: "Spec: Pizza Orders"
sources: [../src/orders, ../src/app.ts]
tests: [../test/orders, ../http/orders.http]
description: The specification for the Orders domain in the pizza-ts example platform
resource: https://notion.com/read_only_publish_page_location
review: ./order.review.md
tags: [pizza, orders, checkout]
timestamp: 2026-08-09T05:00:00Z
---

### Intro

The Orders system creates and retrieves customer pizza orders.

It is the system of record for a placed order. The system creates an order from
a validated request, prices the order from the menu, and stores it as an
immutable record. Downstream systems such as payment, kitchen routing, and
delivery consume an order, but they do not produce one.

After the system creates an order, only an explicit cancellation flow or
adjustment flow can change it. Both flows are Out of Scope for this example.

### Definitions

- Order: A pizza purchase that a customer placed, identified by `id`.
- Customer: The person who placed the order (`customerId`).
- Menu Item: A pizza that a customer can buy, with a `basePrice` in cents.
- Size: One of `small`, `medium`, or `large`. The size scales the unit price.
- Order Item: One line on an order — a pizza, a size, and a quantity — with a price.
- Order Total: The sum of all line totals, in cents.
- Placed At: The time when the system commits the order (ISO 8601).
- Status: The lifecycle state of the order (CREATED, PAID, FULFILLED, CANCELLED).

### Scope

## In Scope
- Show the pizza menu and the price for each size
- Create an order from a validated request
- Price each line item from the menu and the size multiplier
- Calculate the order total from the line items
- Store an immutable order record for the life of the process
- Retrieve an order by its id

## Out of Scope
- Payment authorization and capture
- Inventory and stock management
- Delivery, dispatch, and kitchen routing
- Durable persistence (a database)
- Authentication and authorization

### Functional Requirements

| ID   | Requirement |
|------|------------|
| FR-1 | Create an order from a request that has a customer and one item or more |
| FR-2 | Calculate each line total and the order total from the menu price and the size multiplier |
| FR-3 | Reject each change to an order after the system creates it |
| FR-4 | Reject a request that has no customer, has no items, or has an invalid item |
| FR-5 | Retrieve an order by its id |

### QA Test Cases

A requirement is a higher-level statement, and **one test case or more**
validates it. Here `FR-2` (the price) owns `TC-WEZK`, `TC-TUBJ`, and
`TC-0QQE`, and `FR-4` (validation) owns `TC-ZFJF`, `TC-CV9T`, and `TC-JJBH`.

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|------------|----------|------------------|
| TC-5B8L | FR-1 | The customer submits a valid request | The system creates the order with status CREATED |
| TC-WEZK | FR-2 | The customer orders a small pizza | The unit price equals the base price |
| TC-TUBJ | FR-2 | The customer orders a large pizza | The unit price is the base price × the size multiplier, rounded to the cent |
| TC-0QQE | FR-2 | The order has two line items | The order total is the sum of the line totals (unit price × quantity) |
| TC-KK60 | FR-3 | The caller changes the returned order object | The stored order does not change |
| TC-ZFJF | FR-4 | The request has no `customerId` | The API returns status 400 |
| TC-CV9T | FR-4 | The `items` list is empty | The API returns status 400 |
| TC-JJBH | FR-4 | The request names an unknown pizza, or a quantity of zero or less | The API returns status 400 |
| TC-JKUK | FR-5 | The client requests a known id, then an unknown id | The API returns 200 with the order, then 404 |
