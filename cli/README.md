# spec-md CLI

Lint, coverage, and scaffolding tooling for [`*.spec.md`](https://github.com/rosenjcb/spec.md)
documents. Zero runtime dependencies, works with Node ≥ 18.

`spec-md` treats your specs as a checkable artifact: it validates the frontmatter
and `FR-N` / `TC-N` structure, cross-references every `TC-N` against the `[TC-N]`
tags in your test suite so spec coverage becomes a CI gate, and — where a spec
declares one — explores its executable **behavioral model** and conformance-tests
the implementation against it.

## Install

```bash
# one-off, no install
npx @rosenjcb/spec-md lint

# project dev dependency
npm install --save-dev @rosenjcb/spec-md

# global
npm install --global @rosenjcb/spec-md
```

## Commands

| Command | What it does |
|---------|--------------|
| `spec-md lint [paths…]` | Validate frontmatter (`type`, `title`, path fields incl. `review`, `timestamp`, `resource` URLs on specs and linked reviews), FR/TC/model ids (unique, contiguous, ascending `1..n`), duplicate ids, TC→FR references, model structure, and requirement↔model drift. |
| `spec-md coverage [paths…]` | Report which `TC-N` have at least one `[TC-N]` test, and flag tags that reference a `TC-N` the spec never declares. |
| `spec-md check [paths…]` | `lint` + `coverage` + `model check`, strict. The one to run in CI. |
| `spec-md model check [paths…]` | Explore each behavioral model breadth-first: every `INV-N` and `BP-N` must hold. Reports the minimal counterexample. (Default subcommand.) |
| `spec-md model test [paths…]` | Conformance: replay generated action sequences against the implementation through the model's `adapter` and compare each observation with the model's prediction. |
| `spec-md model list [paths…]` | Print each model's state, actions, invariants, and properties with their `FR-N` traces. |
| `spec-md list [paths…]` | List every spec with FR/TC counts and a coverage bar. |
| `spec-md new <domain>` | Scaffold `<domain>.spec.md` from the canonical template. (`create` / `init` aliases) |

Paths default to the current directory and are searched recursively for
`*.spec.md` files (build and dependency directories are skipped).

### Options

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `--strict` | lint, coverage, check, model | Exit non-zero on warnings / coverage gaps / unexercised properties. |
| `--require-approved` | lint, check | Fail unless every review record linked from a spec's `review` key has `status: approved`. Specs with no linked review — and notice records with no `status` — are not gated; the [review lifecycle](https://github.com/rosenjcb/spec.md/blob/main/REVIEW.md) is opt-in per spec. |
| `--json` | lint, coverage, list, model | Machine-readable output. |
| `--tests <path>` | coverage | Search this path for `[TC-N]` tags instead of the spec's `tests` field. |
| `--no-drift` | lint, check | Skip the requirement/model drift heuristics. |
| `--no-model` | check | Skip the behavioral model step. |
| `--conform` | check | Also run `model test` (imports each model's adapter and executes your implementation). |
| `--depth <n>` | model | Action-sequence depth to explore. Default `4`. |
| `--max-states <n>` | model check | State budget. Default `4000`. |
| `--max-traces <n>` | model test | Trace budget. Default `200`. |
| `--max-inits <n>` | model | Generated initial states. Default `8`. |
| `--max-args <n>` | model | Values tried per action parameter. Default `3`. |
| `--out <path>` | new | Output file path. |
| `--sources`, `--tests`, `--title` | new | Seed the generated frontmatter. |
| `--model` | new | Include a Behavioral Model section in the scaffold. |
| `--force` | new | Overwrite an existing file. |

## How coverage works

A spec's `tests` frontmatter field points at where its verification lives.
`spec-md coverage` reads those spec-relative paths, scans them for `[TC-N]`
tags embedded in test names, and matches them against the `TC-N` rows in the
spec. Rows marked `[REMOVED]` are ignored. If a spec declares no `tests`, the
search falls back to the paths you passed on the command line.

```
$ spec-md coverage examples/pizza-ts
████████████████████ 100% examples/pizza-ts/specs/order.spec.md (9/9)

✓ Overall 100% — 9/9 test cases have a [TC-N] test
```

## Behavioral models

A spec may declare an executable model in a fenced ` ```spec-model ` block —
state, actions (`AC-N`), invariants (`INV-N`), and behavioral properties
(`BP-N`). `model check` explores it; `model test` checks that the implementation
conforms, through an adapter the model names:

```
$ spec-md model check examples/counter-js
✓ MOD-1 Counter examples/counter-js/counter.spec.md
  explored 20 state(s), 89 transition(s) to depth 4 · 4/4 properties exercised

✓ 1 model(s), 0 violation(s), 0 unexercised properties
```

```
$ spec-md model test examples/counter-js
✓ MOD-1 Counter examples/counter-js/counter.spec.md
  200 trace(s), 476 action(s), 676 observation(s) conform

✓ 1 model(s) conform, 0 failure(s)
```

A failure is reported as the minimal counterexample — the shortest action
sequence that breaks the contract — together with the `FR-N` / `AC-N` rows
involved and the two ways to resolve it. Specs with no model are untouched by
these commands.

The language, the adapter contract, the bounds, and the limits:
[MODELS.md](https://github.com/rosenjcb/spec.md/blob/main/MODELS.md).

## Exit codes

- `0` — success (lint clean of errors; coverage complete when `--strict`; models
  free of violations).
- `1` — lint errors, model violations or conformance failures, or `--strict`
  warnings / coverage gaps.
- `2` — usage error / unexpected failure.

## In CI

```yaml
- run: npx @rosenjcb/spec-md check --strict
```

To use spec review as a merge gate — the spec and its review record ride
the feature branch together, and the PR only goes green once the record's
`status` flips to `approved`:

```yaml
- run: npx @rosenjcb/spec-md check --strict --require-approved
```

Conformance executes your implementation, so `check` leaves it opt-in:

```yaml
- run: npx @rosenjcb/spec-md check --strict --conform
```

See the repository root for a reusable GitHub Action (`rosenjcb/spec.md`) that
wraps this command.
