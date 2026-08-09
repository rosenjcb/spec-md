---
type: Review
title: "Review: Pizza Orders — pre-build signoff"
spec: ./order.spec.md
revision: d4e5f6a
mode: signoff
milestone: pre-build
status: approved
driver: hank.hill@stricklandpropane.com
approvers: [buck.strickland@stricklandpropane.com]
contributors: [joe.jack@stricklandpropane.com, enrique@stricklandpropane.com]
informed: [support, sales]
deadline: 2026-07-04
resource: https://notion.com/read_only_publish_page_location
timestamp: 2026-07-02T00:00:00Z
---

The briefing below is the whole request. We wrote it for your role from
[the spec](./order.spec.md) at revision `d4e5f6a`, and every claim in it cites
the section or the ID it comes from. If it is correct and complete for your
area, check the box next to your name to record your approval. If something is
wrong or absent, comment on the spec or tell the driver. We build when every
approver signs off. If a contributor says nothing before the deadline, we read
that as "no objection".

| Role | Who | Asked to | Done |
|------|-----|----------|------|
| Approver | Buck Strickland (Product) | Approve | [x] 2026-07-02 |
| Contributor | Joe Jack (QA) | Review and comment before the deadline | Commented 2026-06-30 |
| Contributor | Enrique (Design) | Review and comment before the deadline | — (no objection) |
| Informed | Support, Sales | Nothing — for information | — |

### Briefings

**Buck Strickland (Product)** — You approve the business shape of Orders. A
customer orders from a fixed menu. The price comes from the menu, and a
multiplier for each size adjusts it. No one can change an order after a
customer places it
([FR-1](./order.spec.md#functional-requirements) to [FR-3]). Anyone can
retrieve a placed order by its id ([FR-5]). This system does not do payment,
inventory, or delivery ([Scope](./order.spec.md#scope)).

**Joe Jack (QA)** — The acceptance criteria are nine concrete cases
([QA Test Cases](./order.spec.md#qa-test-cases)). The API returns status 400 for
each invalid request: no customer, an empty item list, or an unknown pizza
([TC-ZFJF], [TC-CV9T], [TC-JJBH]). The price rounds to the cent after the size multiplier
([TC-TUBJ]). The API returns 404 for an unknown id ([TC-JKUK]). Tell us before the
deadline about each case your harness cannot assert.

**Enrique (Design)** — The order flow has three sizes at fixed multipliers, and
it has no price for each topping
([Definitions](./order.spec.md#definitions)). After a customer places an order,
the customer can only view it, never edit it ([FR-3], [FR-5]). Tell us now if
checkout needs an edit or a custom price. Both are out of scope
([Scope](./order.spec.md#scope)).

**Support, Sales (for information)** — After this ships, a placed order is
immutable. A change is a cancellation, not an edit ([FR-3]).

**Outcome:** approved 2026-07-02. The build proceeds from the spec at the
revision above.
