<div align="center">

<img src="./assets/logo.svg" alt="spec.md" width="148" height="148" />

<h1>spec.md</h1>

<p><strong>An agent-native specification framework for the software development lifecycle.</strong></p>

<p><em>The constraint is no longer implementation speed.<br />The constraint is alignment.</em></p>

<p>
  <img src="https://img.shields.io/badge/version-0.3.5-6366F1" alt="Version" />
  <img src="https://img.shields.io/badge/status-draft-8B5CF6" alt="Status: draft" />
  <img src="https://img.shields.io/badge/built%20on-Open%20Knowledge%20Format-22C55E" alt="Built on Open Knowledge Format" />
</p>

</div>

---

## Install

Get spec.md into your project in one line. Full guide: **[INSTALL.md](./INSTALL.md)**.

```bash
# Claude Code — plugin (skill + /spec-md:create, /spec-md:update, /spec-md:check, /spec-md:coverage)
/plugin marketplace add rosenjcb/spec.md
/plugin install spec-md@spec-md

# Any agent — install the skill + rule files (Cursor, Windsurf, Cline, Copilot, AGENTS.md)
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh | bash

# CLI — lint specs and check TC-N test coverage (great in CI)
npx @rosenjcb/spec-md check
```

| Surface | What you get |
|---------|--------------|
| **Claude Code plugin** | The skill plus `/spec-md:create`, `/spec-md:update`, `/spec-md:check`, `/spec-md:coverage`. |
| **`install.sh` / `install.ps1`** | The skill for Claude Code and rule files for Cursor, Windsurf, Cline, Copilot, and a portable `AGENTS.md`. |
| **[`spec-md` CLI](./cli)** | `lint`, `coverage`, `check`, `list`, `new` — validate specs and enforce `[TC-N]` coverage. |
| **[GitHub Action](./action.yml)** | `uses: rosenjcb/spec.md@main` — fail CI when a spec drifts or a test case loses its test. |

Every agent rule file is generated from [`SKILL.md`](./SKILL.md) so nothing drifts.

---

## Motivation

In 2026, most software is no longer written line-by-line by humans. Frontend applications, backend services, infrastructure, migrations, tests, and documentation are routinely generated or assisted by AI systems.

This changes the shape of development.

Teams can now produce working software quickly. What used to take weeks can be scaffolded in hours and refined continuously. The constraint is no longer implementation speed.

The constraint is alignment.

As more of the system is produced by agents, ambiguity becomes more expensive. A missing requirement or unclear rule no longer stays local. It gets replicated across the code, tests, APIs, and infrastructure generated from the same misunderstanding.

Small gaps in understanding lead to large system drift:

* incorrect implementations
* broken or incomplete test coverage
* inconsistent APIs
* incorrect assumptions in infrastructure
* repeated QA cycles
* rework across multiple services

The faster we generate software, the more important it becomes that we define *what we actually mean* before we generate it.

Modern software development already reflects this reality. Requirements emerge as teams learn by building, and systems evolve as that understanding improves.

This iteration is healthy, and the aim is to make it explicit, structured, and shareable instead of leaving it implicit.

This document defines a way to treat software development as a shared knowledge system between Product, Engineering, QA, and AI agents.

Instead of static requirement documents, specs become living context that evolves alongside the system they describe.

The framework uses and extends the Open Knowledge Format (OKF) to structure this context so it can be consumed by both humans and agents. The result is a consistent, machine-readable model of intent, behavior, and constraints that stays synchronized with the system as it changes, rather than another pile of documentation to maintain by hand.

---

## What is a spec?

A spec is the authoritative description of a system: what it does, why it exists, and how it should behave.

In practice, it serves different roles depending on who is using it.

For business stakeholders, it captures:

* the problem being solved
* expected outcomes
* constraints and success criteria
* intent behind the product

For product and design, it captures:

* user experience and flows
* behavior and interaction rules
* edge cases and usability constraints
* intended system behavior

For engineering, it captures:

* system boundaries and responsibilities
* APIs and data contracts
* implementation constraints
* validation rules and invariants
* operational expectations

For QA, it captures:

* expected system behavior
* acceptance criteria
* failure conditions
* regression coverage

For AI agents, the spec becomes executable context:

* what to build
* what not to build
* how components should behave
* how to validate correctness

Beyond describing a feature, a spec is a shared model of the system that connects intent to implementation.

This introduces a natural tension:

A spec needs enough detail to remove ambiguity, but not so much rigidity that it becomes invalid as the system evolves.

Too little detail leads to inconsistent interpretations across teams and agents.

Too much rigidity leads to outdated assumptions and constant rewriting.

A useful spec tracks how understanding of the system changes over time instead of trying to freeze it in place.

---

## Example

The example below is structured as an [Open Knowledge Format (OKF)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) document — the format spec.md builds on to make specs consumable by both humans and agents.

To make this concrete, we’ll break the `order.spec.md` into modular sections. Each section is self-contained and represents a unit of the spec.

---

### order.spec.md (metadata)

```yaml
---
type: Spec
title: Spec: Orders
sources: [./src/orders]
tests: [./test/orders]
description: The specification for the Orders domain in the Foo platform
resource: https://notion.com/read_only_publish_page_location
tags: [sales, orders, revenue]
timestamp: 2026-05-28T14:30:00Z
---
```

---

This block defines the identity and external connections of the spec. Only `type` and `title` are required; every other key is optional and can be added as the spec matures.

| Key | Required | Purpose |
|-----|----------|---------|
| `type` | **Yes** | The OKF document type. For a spec.md file this is always `Spec`. |
| `title` | **Yes** | Human-readable name of the spec. |
| `sources` | No | YAML list of spec-relative paths to the code, schemas, or docs that implement or enforce the spec. |
| `tests` | No | YAML list of spec-relative paths to the verification that proves the spec (unit suites, `.http` requests, e2e). |
| `description` | No | One-line summary of what the spec covers. |
| `resource` | No | External URL where the spec is published or synchronized. |
| `tags` | No | Freeform labels for grouping and discovery. |
| `timestamp` | No | ISO 8601 time the spec was last updated. |

A few of these warrant a closer look.

The `sources` field links the spec to the parts of the system that implement, enforce, or depend on it. This can include application code, schemas, documentation, or anything else that reflects the behavior described here.

The `tests` field links the spec to the verification that proves it — unit suites, integration requests (such as `.http` files), end-to-end suites, or any other executable checks. Keeping tests in their own field separates *what the system does* (`sources`) from *what proves it does so* (`tests`), while letting agents and humans regenerate or validate each independently.

Both fields are **YAML lists of paths relative to the spec file itself**, so a spec stays portable regardless of where it lives in the tree. In simple cases each can point to a single folder (e.g. `sources: [./src/orders]`, `tests: [./test/orders]`). In more complex systems they may be expanded into multiple paths such as `[./src/orders, ./src/app.ts]` for `sources` and `[./test/orders, ./http/orders.http]` for `tests`. A spec with no implementation or tests yet can omit them and add them as the system grows.

The intent is not to precisely define architecture, but to give the spec a way to stay connected to the real system as it evolves.

Because both fields are spec-relative, **where you keep the spec file is up to you**. It can live next to the code it describes (`src/orders/order.spec.md`) or in a dedicated specs directory — either is fine, and the two can coexist in the same repo. The example in this repo uses a `specs/` folder, but that is one convention, not a requirement; just set `sources` and `tests` relative to wherever the spec lives.

The `resource` field defines where this spec is published or synchronized externally.

---

```md
### Intro

The Orders system handles creation and tracking of customer purchases.

It is the system of record for all completed transactions and feeds downstream systems such as billing, analytics, fulfillment, and support.

Once created, orders are considered immutable except through explicit refund or adjustment flows.
```

This defines the system’s purpose and lifecycle boundaries.

---

```md
### Definitions

- Order: A completed purchase transaction.
- Customer: The user who placed the order (`customer_id`).
- Order Total: Final amount after discounts, taxes, and adjustments.
- Placed At: Timestamp when the order is committed.
- Status: Lifecycle state of the order (CREATED, PAID, FULFILLED, REFUNDED).
```

This establishes shared vocabulary used across Product, Engineering, QA, and agents.

---

```md
### Scope

## In Scope
- Create orders from validated checkout sessions
- Persist immutable order records
- Compute totals from line items
- Emit order creation events
- Support refunds and partial refunds

## Out of Scope
- Inventory management
- Payment authorization logic
- Shipping integrations
- Pricing rules engine
```

This defines system boundaries and prevents responsibility drift.

---

```md
### Functional Requirements

| ID   | Requirement |
|------|------------|
| FR-1 | Create order after successful checkout |
| FR-2 | Compute totals correctly from pricing inputs |
| FR-3 | Prevent modification of finalized orders |
| FR-4 | Each order must belong to one customer |
| FR-5 | Emit order-created event within 5 seconds |
```

These define system behavior in testable units.

A functional requirement is a *higher-level* statement of intent. It maps to
implementation and validation logic, and a single requirement is usually proven
by several test cases.

---


```md
### QA Test Cases

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|------------|----------|------------------|
| TC-1 | FR-1 | Valid checkout completes | Order created successfully |
| TC-2 | FR-2 | Discount applied | Total reflects discount |
| TC-3 | FR-2 | Tax applied | Total includes tax |
| TC-4 | FR-3 | Modify order after creation | Request rejected |
| TC-5 | FR-4 | Missing customer_id | Validation error |
| TC-6 | FR-5 | Order created | Event emitted within SLA |
```

These are executable validation conditions derived from requirements.

They form the bridge between spec and automated verification.

Note the **Requirement** column: a single functional requirement can own many
test cases. Above, `FR-2` ("compute totals correctly") is proven by both `TC-2`
(discounts) and `TC-3` (tax) — and a real pricing requirement might add cases
for rounding, multiple line items, and currency. A requirement expresses
higher-level intent; the test cases are the concrete checks that prove it.

---

## Next Readings

- [TESTING.md](./TESTING.md) — how tests relate to a `*.spec.md`. Covers unit and integration tests and the `[TC-N]` tag convention embedded in the test name, where the tag links each test back to a QA Test Case in the spec. Suggests (but does not require) Gherkin **Given / When / Then** phrasing.
- [REVIEW.md](./REVIEW.md) — how a spec gets reviewed and signed off. A `*.review.md` record beside the spec (OKF `type: Review`) carries the roles, per-stakeholder briefings, and the approval state — everything derived from the spec, never a hand-maintained copy that can drift.
- [examples/pizza-ts](./examples/pizza-ts) — a runnable reference implementation generated from a single OKF spec, with tagged unit tests and `.http` integration requests that trace back to it.

### Appendix: References

- Google Cloud Blog: How the Open Knowledge Format can improve data sharing: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing
- GoogleCloudPlatform OKF Spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
