# spec-md CLI

Lint, coverage, and scaffolding tooling for [`*.spec.md`](https://github.com/rosenjcb/spec.md)
documents. Zero runtime dependencies, works with Node ≥ 18.

`spec-md` treats your specs as a checkable artifact. It validates the
frontmatter and the `FR-N` / `TC-N` structure. It also cross-references each
`TC-N` against the `[TC-N]` tags in your test suite, so that spec coverage
becomes a CI gate.

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
| `spec-md lint [paths…]` | Validate frontmatter (`type`, `title`, path fields incl. `review`, `timestamp`, `resource` URLs on specs and linked reviews), FR/TC ids (unique, contiguous, ascending `1..n`), duplicate ids, and TC→FR references. |
| `spec-md coverage [paths…]` | Report which `TC-N` have at least one `[TC-N]` test, and flag tags that reference a `TC-N` the spec never declares. |
| `spec-md check [paths…]` | `lint` + `coverage`, strict. The one to run in CI. |
| `spec-md list [paths…]` | List every spec with FR/TC counts and a coverage bar. |
| `spec-md new <domain>` | Scaffold `<domain>.spec.md` from the canonical template — the sections, the id rules, and the [Simplified Technical English](https://github.com/rosenjcb/spec.md#the-language) house style. (`create` / `init` aliases) |

Paths default to the current directory. The CLI searches them recursively for
`*.spec.md` files, and skips build and dependency directories.

### Options

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `--strict` | lint, coverage, check | Exit non-zero on warnings / coverage gaps. |
| `--require-approved` | lint, check | Fail unless every review record linked from a spec's `review` key has `status: approved`. Specs with no linked review — and notice records with no `status` — are not gated; the [review lifecycle](https://github.com/rosenjcb/spec.md/blob/main/REVIEW.md) is opt-in per spec. |
| `--json` | lint, coverage, list | Machine-readable output. |
| `--tests <path>` | coverage | Search this path for `[TC-N]` tags instead of the spec's `tests` field. |
| `--out <path>` | new | Output file path. |
| `--sources`, `--tests`, `--title` | new | Seed the generated frontmatter. |
| `--force` | new | Overwrite an existing file. |

## How coverage works

The `tests` frontmatter field of a spec points at where its verification lives.
`spec-md coverage` reads those spec-relative paths, scans them for the `[TC-N]`
tags in the test names, and matches the tags against the `TC-N` rows of the
spec. It ignores a row marked `[REMOVED]`. If a spec declares no `tests`, the
search uses the paths you gave on the command line.

```
$ spec-md coverage examples/pizza-ts
████████████████████ 100% examples/pizza-ts/specs/order.spec.md (9/9)

✓ Overall 100% — 9/9 test cases have a [TC-N] test
```

## Exit codes

- `0` — success (lint clean of errors; coverage complete when `--strict`).
- `1` — lint errors, or `--strict` warnings / coverage gaps.
- `2` — usage error / unexpected failure.

## In CI

```yaml
- run: npx @rosenjcb/spec-md check --strict
```

To use the spec review as a merge gate, put the spec and its review record on
the same feature branch. CI stays red until the `status` of the record becomes
`approved`:

```yaml
- run: npx @rosenjcb/spec-md check --strict --require-approved
```

See the repository root for a reusable GitHub Action (`rosenjcb/spec.md`) that
wraps this command.
