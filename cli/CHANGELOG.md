# @rosenjcb/spec-md

## 0.4.0

### Minor Changes

- Add the executable **behavioral model** layer: a `### Behavioral Model` section holding a fenced ```spec-model block with `state`, `derived`, actions (`AC-N`), invariants (`INV-N`), and behavioral properties (`BP-N`). New `spec-md model check` explores the model's state/action space breadth-first and reports the minimal counterexample; `spec-md model test` conformance-tests an implementation against it through an adapter the model names; `spec-md model list` prints the contract. `spec-md check` now includes the model step (`--no-model` to skip, `--conform` to also run conformance), `spec-md lint` validates model structure, enforces contiguous `MOD`/`AC`/`INV`/`BP` ids, resolves `TC-N` citations of model ids, and warns on likely requirement/model drift (`--no-drift` to skip). `spec-md new --model` scaffolds the section, and the GitHub Action gains a `conform` input. The layer is opt-in: specs without a model are unaffected. The pizza-ts example gains a model and a conformance adapter driving the real `OrderStore`. See MODELS.md.

## 0.3.5

### Patch Changes

- Claude Code surface is `/spec-md` (skill: create or update) plus `/spec-md:check` and `/spec-md:coverage` only. Drop author/create/update/new command stems and the nested `skills/spec-md/` copy (root `SKILL.md` is the plugin skill). Portable Agent Skills path is `.agents/skills/spec-md/` for Cursor/Codex. CLI gains a `create` alias for `new`.

## 0.3.4

### Patch Changes

- Fix Claude Code plugin command names: files are action-only (`update.md`, `check.md`, `coverage.md`, `new.md`) so invocations are `/spec-md:update`, `/spec-md:check`, `/spec-md:coverage`, `/spec-md:new`. Previous `spec:update.md` / `spec-update.md` stems double-prefixed under plugin `spec-md`. Docs and a regression test lock the mapping.

## 0.3.3

### Patch Changes

- Rename Claude Code plugin subcommands from dash form (`/spec-update`, `/spec-check`, `/spec-coverage`) to colon form (`/spec:update`, `/spec:check`, `/spec:coverage`).

## 0.3.2

### Patch Changes

- Lint FR/TC tables for contiguous ascending ids (`FR-1..FR-n`, `TC-1..TC-n`) so jumbled or skipped indexes fail `spec-md lint` / `check`. Skill and agent adapters teach append-by-default cleanup that renumbers with matching `[TC-N]` tag updates.

## 0.3.1

### Patch Changes

- Add support for `resource` URL validation on linked `*.review.md` frontmatter, matching spec `resource` handling.

## 0.3.0

### Minor Changes

- af5c8bc: Add `--require-approved` to `lint` and `check`: the gate reads the review
  record linked from a spec's `review` key and fails while the record's
  `status` is not `approved`, so a spec and its review ride the feature
  branch together and the PR merges once the sign-off lands. Specs without a
  linked review — and notice records without a `status` — are not gated.
  Lint also verifies that a spec-relative `review` path exists on disk (URL
  values are left alone).

### Patch Changes

- `spec-md new` scaffolds `sources`/`tests` as YAML inline arrays, the
  canonical form for frontmatter path lists.
- Frontmatter path fields (`sources`, `tests`, `review`) are read as YAML
  lists; a bare scalar is read as a single path.

## 0.2.0

### Initial release

- `lint`, `coverage`, `check`, `list`, and `new` commands for `*.spec.md` files
- Zero-dependency Node.js CLI
- GitHub Action wrapper via `npx @rosenjcb/spec-md`
