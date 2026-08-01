---
description: Report which TC-N test cases have a matching [TC-N] test, and surface coverage gaps.
argument-hint: "[path] (defaults to the whole repo)"
allowed-tools: Bash(npx @rosenjcb/spec-md:*), Bash(node:*), Read, Grep, Glob
---

Check spec test-case coverage for: **${ARGUMENTS:-the whole repository}**

Run:

```
npx @rosenjcb/spec-md coverage ${ARGUMENTS:-.}
```

This command cross-references each `TC-N` row against the `[TC-N]` tags in the
`tests` paths of the spec. If `spec-md` is not available, do it by hand: for
each spec, collect its `TC-N` ids and run `grep -r "\[TC-N\]"` across the
`tests` paths.

Then:

1. List each **uncovered** `TC-N` — a row with no `[TC-N]` test.
2. List each **orphan tag** — a `[TC-N]` in the tests that no spec declares.
   An orphan tag signals a row that the spec does not have.
3. For each gap, recommend the concrete next step: write the missing test with
   the `[TC-N]` tag, or add the missing `TC-N` row to the spec. Apply the
   update rules of the spec-md skill.

Summarize the result as a coverage table. Write a test or edit a spec only if I
ask.
