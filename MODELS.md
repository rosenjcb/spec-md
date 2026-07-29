# Behavioral models in spec.md

> Tests protect examples. Models protect behavior.

A test suite passes when the examples someone thought to write still hold. It
says nothing about the combinations nobody wrote down. So an implementation
change can quietly redefine what the product does and still ship green.

A **behavioral model** closes that gap. It is an executable statement of the
contract, written inside the spec, that turns "does the system still do what the
spec says?" into a question a machine can answer — and when the answer is no, it
forces an explicit decision: fix the implementation, or update the spec.

The model layer is **entirely optional**. A `*.spec.md` with no
`### Behavioral Model` section behaves exactly as it always has.

Everything below is drawn from the worked example in
[`examples/pizza-ts`](./examples/pizza-ts): the model lives in
[`specs/order.spec.md`](./examples/pizza-ts/specs/order.spec.md) and is driven
against the real implementation through
[`model/orders.adapter.mjs`](./examples/pizza-ts/model/orders.adapter.mjs).

## Contents

- [The four kinds of drift](#the-four-kinds-of-drift)
- [The layers](#the-layers)
- [The state transition model is primary](#the-state-transition-model-is-primary)
- [The language](#the-language)
- [Two kinds of coverage](#two-kinds-of-coverage)
- [Conformance testing](#conformance-testing)
- [The adapter contract](#the-adapter-contract)
- [Drift detection in lint](#drift-detection-in-lint)
- [In CI](#in-ci)
- [Bounds](#bounds)
- [Limits](#limits)

---

## The four kinds of drift

| Drift | What happened |
|-------|---------------|
| **Requirement drift** | The product expectation changed, but the spec was not updated |
| **Implementation drift** | Code changed behavior without changing the spec |
| **Test drift** | Tests no longer adequately enforce the spec |
| **Model drift** | The model no longer represents the written requirements |

`spec-md lint` and `spec-md coverage` already make test drift visible. The model
layer makes implementation drift and model drift visible too, and surfaces
likely requirement drift for a human to judge.

---

## The layers

Each layer has a different role and a different level of formality:

| Layer | Role |
|-------|------|
| Written requirements (`FR-N`) | Human intent |
| Behavioral model (state + actions `AC-N`) | Precise executable contract |
| Invariants and properties (`INV-N`, `BP-N`) | Important named guarantees |
| Generated exploration | Broad behavioral coverage |
| Concrete test cases (`TC-N`) | Named examples and regressions |
| Implementation | Actual behavior |

The formal machinery gives strong guarantees **below the model** — model →
generated checks → implementation. The relationship **above** it, human
requirements ↔ model, is semantic and cannot be proven; there, tooling surfaces
likely inconsistencies and agents help, but judgment stays human.

```mermaid
flowchart TB
    fr["FR-N<br/>human intent"]
    model["MOD-N<br/>state + AC-N transitions"]
    props["INV-N / BP-N<br/>named guarantees"]
    explore["spec-md model check<br/>behavioral exploration"]
    tc["TC-N<br/>named examples"]
    impl["Implementation"]

    fr -- "agents + drift lint<br/>(semantic)" --> model
    model --> props
    model --> explore
    fr --> tc
    explore -- "spec-md model test<br/>(conformance)" --> impl
    tc -- "[TC-N] tagged tests" --> impl
```

---

## The state transition model is primary

The model — not the list of properties — is the source of truth. Properties are
*additional* claims about it.

```text
State:
  lineCount, total, status

AddItem:
  lineCount' = lineCount + 1
  total'     = total + unitPrice * quantity

PlaceOrder:
  status' = created
```

That matters because the transition model generates broad behavior through
exploration. Forgetting to name a property is not catastrophic: the model still
defines what each operation does, and the checker still walks every state/action
combination within its bounds.

In spec.md, that model lives in a fenced ` ```spec-model ` block inside the
spec's `### Behavioral Model` section:

````md
### Behavioral Model

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
````

Ids follow the same hygiene as `FR-N` and `TC-N`: `MOD-1..MOD-n`, `AC-1..AC-n`,
`INV-1..INV-n`, `BP-1..BP-n`, contiguous and ascending in document order.
`spec-md lint` enforces it. `AC`/`INV`/`BP` numbering runs across all of a spec's
model blocks, so an id is unambiguous anywhere in the spec.

---

## The language

### `model:` and `adapter:`

```text
model: MOD-1 Orders                         # id and name; defaults to MOD-<block index>
adapter: ../model/orders.adapter.mjs        # spec-relative; required by `model test`
```

### `state:`

One declaration per line, `name: type [in domain] [= default]`.

```text
state:
  status: string in [draft, created] = draft
  lineCount: integer in 0..3 = 0
  total: integer in 0..20000 = 0
  basePrice: integer = 900
  paid: boolean = false
```

Types are `integer`, `number`, `boolean`, `string`. The **state is an
abstraction** of the implementation, not a copy of it — model what the contract
is about, at the smallest scale that still says something. Above, an order is
three scalars and a menu price; the array of line items never appears.

`in …` declares a **domain**: `lo..hi` for numbers, `[a, b, c]` for an
enumeration. Domains bound the *search* (see [Bounds](#bounds)); they are not
requirements. Values of a string enum become symbols you can write bare in
expressions (`status = created`), so a typo is an error rather than a silent
mismatch. A variable with no domain — like `basePrice` — is a constant the model
carries: never varied, and still checked against the implementation.

### `derived:`

Values computed from the state — what an observer sees rather than what the
system stores.

```text
derived:
  placed: status = created
  average: total / max(1, lineCount)
```

Derived variables are recomputed after every transition, may be used in guards,
invariants, and properties, and cannot be assigned by an action. They are also
compared during conformance, which is where they earn their place: the model
computes `placed` from `status`, while the implementation answers it by whether
an order exists.

### `AC-N` — actions

```text
AC-1 AddItem(sizeMultiplier: number in [1, 1.3, 1.6], quantity: integer in 1..2):
  requirement: FR-2
  requires: status = draft
  lineCount' = lineCount + 1
  total' = total + round(basePrice * sizeMultiplier) * quantity
```

| Line | Meaning |
|------|---------|
| `AC-N Name(params):` | The action. Parameters are declared like state variables, without defaults. |
| `requirement: FR-1, FR-2` | Which `FR-N` this action implements. Traceability upward. |
| `requires: <expr>` | Guard. The action is only offered when it holds. Repeat the line to add clauses (they conjoin). |
| `<var>' = <expr>` | The state after. Every right-hand side reads the **pre**-state, so `a' = b` / `b' = a` swaps. |

An action needs at least one update.

### `INV-N` — invariants

A claim that must hold in **every** state the explorer reaches.

```text
INV-1 A placed order has at least one priced line:
  requirement: FR-1
  check: status = created implies lineCount > 0
```

Invariants also define which generated initial states are valid: a candidate
that breaks one is not a legitimate place to start, so it is skipped. That
matters more than it sounds — see [Bounds](#bounds).

### `BP-N` — behavioral properties

Named claims about the model, in one of three forms:

| Form | Meaning |
|------|---------|
| `after AC-N, <expr>` | Holds in the state after `AC-N`. `x@pre` reads the value before it; the action's parameters are in scope. |
| `AC-N then AC-M preserves <expr>` | Running the sequence leaves the expression unchanged. Parameters shared **by name** across the sequence are bound once, so `AddItem(qty) then RemoveItem(qty)` lines up. |
| `always <expr>` | Holds in every state (an invariant, stated as a property). |

```text
BP-1 Each line adds its rounded unit price times quantity to the total:
  requirement: FR-2
  check: after AC-1, total = total@pre + round(basePrice * sizeMultiplier) * quantity
```

A property that is never *triggered* within the configured bounds is reported —
a claim nothing exercises proves nothing.

### Expressions

Arithmetic `+ - * / %`; comparisons `= (==) != (<>) < <= > >=`; logic `not`,
`and`, `or`, `implies`; parentheses; the functions `min`, `max`, `abs`, `floor`,
`ceil`, `round`; number, string (`"draft"`), and boolean literals; `#` starts a
comment. Expressions are parsed and evaluated by spec.md itself — never `eval` —
so checking a spec never means running code the spec smuggled in.

### Linking test cases

A `TC-N` row may cite the model element it exercises alongside its `FR-N`:

```md
| TC-4 | FR-2, AC-1 | Order with several line items | Total sums each line |
```

That completes the chain the ids trace:

```text
FR-2 → BP-1 → AC-1 → TC-4 → [TC-4] test → implementation
```

`spec-md lint` errors on a `TC-N` citing an `AC`/`BP`/`INV`/`MOD` the model does
not declare, the same way it does for a dangling `FR-N`.

---

## Two kinds of coverage

```text
Property coverage:      Did we state and check BP-1 … BP-N?
Behavioral exploration: Did we walk every state/action combination in bounds?
```

`spec-md model check` reports both:

```text
✓ MOD-1 Orders examples/pizza-ts/specs/order.spec.md
  explored 171 state(s), 405 transition(s) to depth 4 · 2/2 properties exercised · 56 at the domain frontier
```

Exploration is the half that finds scenarios nobody thought to name. Add a
discount action and forget that a discount can outrun the total, and it says so —
in the shortest trace that breaks the claim:

```text
Invariant violated

Spec: Pizza Orders
Model: MOD-1 Orders
Invariant: INV-2 Lines and a total appear together — (lineCount = 0) = (total = 0)

Minimal counterexample:
  Initial state: status = "draft", lineCount = 0, total = 0, basePrice = 900, placed = false
  Action: AC-3 ApplyDiscount
  Final state: status = "draft", lineCount = 0, total = -500, basePrice = 900, placed = false

Relevant contract:
  FR-2: Compute line and order totals from menu price and size multiplier

Possible resolutions:
  - Fix the transition model so INV-2 holds within these bounds
  - Update INV-2 (and the requirement it cites) if the claim is no longer intended
```

---

## Conformance testing

`spec-md model check` verifies the model against itself. **Conformance** asks the
other question: does the observed implementation conform to the model?

1. Put the model and the application in corresponding initial states.
2. Perform the same action on both.
3. Observe the application.
4. Compare with the model's predicted state.
5. Repeat over many generated starting states and action sequences.

```ts
const model = { total: 2340 };
const app = draftOrder({ lines: [{ pizza: "margherita", size: "medium", quantity: 2 }] });

model.total += 2880;
await app.addItem({ pizza: "margherita", size: "large", quantity: 2 });

expect(app.total()).toBe(model.total);
```

`spec-md model test` generates that loop:

```text
✓ MOD-1 Orders examples/pizza-ts/specs/order.spec.md
  1000 trace(s), 3646 action(s), 4646 observation(s) conform

✓ 1 model(s) conform, 0 failure(s)
```

Because it generates whole sequences rather than the cases someone thought of,
it catches changes that are locally reasonable but globally inconsistent with the
contract. Cap the order total, say:

```diff
-const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
+const total = Math.min(items.reduce((sum, item) => sum + item.lineTotal, 0), 5000);
```

Every unit test still passes — `TC-4`'s order comes to 4420, comfortably under
the cap. Conformance finds the shortest order that does not:

```text
Behavioral conformance failed

Spec: Pizza Orders
Model: MOD-1 Orders

Minimal counterexample:
  Initial state: status = "draft", lineCount = 0, total = 0, basePrice = 900, placed = false
  Trace:
    1. AC-1 AddItem(sizeMultiplier = 1.3, quantity = 2) → status = "draft", lineCount = 1, total = 2340, basePrice = 900
    2. AC-1 AddItem(sizeMultiplier = 1.6, quantity = 2) → status = "draft", lineCount = 2, total = 5220, basePrice = 900
    3. AC-2 PlaceOrder → status = "created", lineCount = 2, total = 5220, basePrice = 900

Expected:
  total = 5220

Observed:
  total = 5000

Relevant contract:
  FR-1: Create an order from a request with a customer and at least one item
  FR-2: Compute line and order totals from menu price and size multiplier
  AC-2 requires: status = draft and lineCount > 0
  AC-2: status' = created
  AC-1: total' = total + round(basePrice * sizeMultiplier) * quantity
  INV-2: (lineCount = 0) = (total = 0)
  BP-1: after AC-1, total = total@pre + round(basePrice * sizeMultiplier) * quantity
  BP-2: after AC-2, total = total@pre and lineCount = lineCount@pre

Possible resolutions:
  - Restore implementation behavior so it still follows AC-1
  - Update FR-1, FR-2 and AC-1 to define the new behavior, then add the QA Test Case that pins the boundary
```

Note that the failure surfaced at `AC-2 PlaceOrder` — that is where the total
first becomes observable — but the contract it breaks belongs to `AC-1`. The
report names whichever elements *define* the wrong value, not just the action
that tripped over it.

That turns an accidental behavior change into an explicit product decision. The
PR now needs one of two things:

1. **Fix the implementation** so it still follows the model, or
2. **Update the specification** — "the order total is capped at 5000 cents" —
   which forces the model to change, which forces a new `TC-N` for the boundary.

Either way the change is visible and deliberate. Nothing silently redefines the
product.

---

## The adapter contract

The adapter is the whole bridge between a model and an implementation. It is an
ES module Node can import, named by the model's `adapter:` key:

```js
// model/orders.adapter.mjs
import { findMenuItem, unitPriceFor, SIZE_MULTIPLIER } from "../src/orders/menu.ts";
import { OrderStore } from "../src/orders/orders.ts";

export default {
  // Put the implementation in the model's initial state; return any handle.
  init({ status, lineCount, total }) {
    if (status !== "draft" || lineCount !== 0 || total !== 0) {
      throw new Error("cannot realize initial state");
    }
    return { store: new OrderStore(), draft: [], orderId: null };
  },

  // One entry per AC-N, keyed by id or by name. Arguments arrive by parameter name.
  actions: {
    "AC-1": (app, { sizeMultiplier, quantity }) => {
      const size = Object.keys(SIZE_MULTIPLIER).find((s) => SIZE_MULTIPLIER[s] === sizeMultiplier);
      app.draft.push({ pizzaId: "margherita", size, quantity });
    },
    "AC-2": (app) => {
      app.orderId = app.store.create({ customerId: "cust-model", items: app.draft }).id;
    },
  },

  // Report the implementation's state in the model's shape.
  observe(app) {
    const state = {
      basePrice: unitPriceFor(findMenuItem("margherita"), "small"),
      status: app.orderId ? "created" : "draft",
      placed: app.orderId !== null,
    };
    if (!app.orderId) {
      state.lineCount = app.draft.length;
      return state; // `total` is not observable until the order is priced
    }
    const order = app.store.get(app.orderId);
    state.lineCount = order.items.length;
    state.total = order.total;
    return state;
  },

  // Optional.
  // teardown(app) {},
};
```

Every hook may be `async`. Notes:

- **Translation is the adapter's job.** The model works in size *multipliers*;
  the implementation works in pizza ids and size names. Mapping one onto the
  other belongs here so the model can stay an abstraction.
- **Observe only what is observable.** `OrderStore` prices atomically, so before
  `AC-2` there is no total to read. `observe` omits `total` until then, and the
  runner compares only the keys it is given — the accumulated prediction is
  checked in full the moment the order lands in the store. A model variable that
  `observe` never returns at all is reported as not conformance-checked.
- **Only keys the model declares are compared.** Extra keys are ignored, so the
  adapter can return whatever is convenient.
- **Read back, do not trust the return value.** Above, `observe` fetches from the
  store rather than keeping what `create` returned — which is what makes it a
  check on what was *persisted*.
- **Each trace gets a fresh handle.** `init` runs per trace, so state cannot
  leak between them.
- Anything Node can import works: a plain module, a rendered component, an HTTP
  client against a running server. The pizza adapter imports `src/*.ts` directly,
  which needs a Node that strips TypeScript types (≥ 22.18); a project without
  one points its adapter at compiled output instead.

---

## Drift detection in lint

When a requirement changes but the model does not, `spec-md lint` flags the
likely inconsistency. These are heuristics — semantic checks, not proofs — so
they are always warnings, and they only run for specs that declare a model.
Marking `FR-2` as capped without touching the model:

```text
▲ Potential requirement/model drift: FR-2 mentions 5000, which no model element
  tracing to it (AC-1, INV-2, BP-1) references — the model may need a guard
▲ Potential requirement/model drift: FR-2 constrains behavior ("capped"), but
  no guard on AC-1 mentions 5000
▲ FR-2 is marked [UPDATED] — confirm the model elements tracing to it
  (AC-1, INV-2, BP-1) still match
```

Also reported: a model element that cites no `FR-N` (the model is no longer
traceable to intent), and a state variable nothing writes and nothing reads
(left over from an earlier model). Pass `--no-drift` to switch the heuristics
off.

---

## In CI

`spec-md check` runs lint, `[TC-N]` coverage, and `model check`. Conformance
executes your implementation, so it stays opt-in:

```yaml
- run: npx @rosenjcb/spec-md check --strict            # includes model check
- run: npx @rosenjcb/spec-md check --strict --conform  # …and conformance
```

Or with the bundled Action:

```yaml
- uses: rosenjcb/spec.md@main
  with:
    path: .
    strict: "true"
    conform: "true"     # also run `model test`
```

`spec-md model check` / `spec-md model test` can also be run on their own, and
`--json` makes either machine-readable.

---

## Bounds

Exploration is exhaustive **within bounds**, never in general. The bounds:

| Flag | Default | What it bounds |
|------|---------|----------------|
| `--depth <n>` | `4` | Length of the action sequences explored |
| `--max-states <n>` | `4000` | State budget for `model check` |
| `--max-traces <n>` | `1000` | Trace budget for `model test` |
| `--max-inits <n>` | `8` | Generated initial states |
| `--max-args <n>` | `3` | Values tried per action parameter |

Declared domains do two jobs. They pick what to *generate* — initial states move
one variable at a time to its boundaries (min, max, midpoint, or each enum
value), and parameters are sampled the same way — and they mark the **frontier**:
a transition that leaves a domain produces a state that is still checked against
every invariant and property, but is not expanded further. That is what keeps
`lineCount: integer in 0..3` from turning into a requirement while still bounding
the walk. `model check` reports how many states sat at that frontier.

**Generated initial states are only as useful as the state is loose.** In the
orders model, `INV-1` and `INV-2` rule out every boundary candidate — an order
cannot have three lines and a zero total, or be `created` with no lines — so the
declared initial state is the only valid one, and the coverage comes from depth
instead. That is the normal outcome for tightly coupled state, and it is why
invariants matter beyond correctness: they keep generation honest. A model whose
variables move independently (a counter, a cache, a feature flag) gets far more
out of `--max-inits`.

A model whose search hits `--max-states` says so; the run was not exhaustive.

---

## Limits

Worth knowing before you model something large:

- **Scalar state only.** `integer`, `number`, `boolean`, `string`. No lists,
  maps, or records — model the aggregate (`lineCount`, `total`) instead of the
  collection. This is usually the right abstraction anyway, but it is a real
  ceiling.
- **Model what can be driven and observed.** An action needs a real operation
  behind it and a way to read the result back. Input validation (`FR-4` in the
  pizza spec) is a guard on the boundary rather than a state transition, and
  caller-side aliasing (`FR-3`'s "mutate the returned object") is not expressible
  in a state model at all. Say so in the section and leave those to their `TC-N`
  rows rather than pretending the model covers them.
- **Guards constrain generation, not the implementation.** A `requires:` clause
  keeps an action out of generated traces; conformance does not assert that the
  implementation rejects the action when the guard is false.
- **Deterministic models.** One state and one argument tuple produce one next
  state. No non-determinism, no concurrency, no time.
- **The layer above stays human.** Drift detection between requirements and
  model is heuristic by nature. Intent is not purely mathematical; tooling can
  surface likely inconsistencies and force a decision, not settle it.

---

## Next readings

- [TESTING.md](./TESTING.md) — the `[TC-N]` tag convention that links concrete
  test cases to the spec.
- [SKILL.md](./SKILL.md) — the authoring procedure agents follow, including when
  a spec is worth modeling.
- [examples/pizza-ts](./examples/pizza-ts) — the worked example: spec, model,
  adapter, tagged tests, and the capped-total regression above, end to end.
