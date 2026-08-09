---
description: Report which Test IDs have a matching [TC-XXXX] test, and surface coverage gaps.
argument-hint: "[path] (defaults to the whole repo)"
allowed-tools: Bash(npx @rosenjcb/spec-md:*), Bash(node:*), Read, Grep, Glob
---

Check spec test-case coverage for: **${ARGUMENTS:-the whole repository}**

Run:

```
npx @rosenjcb/spec-md coverage ${ARGUMENTS:-.}
```

This command cross-references each Test ID row against the `[TC-XXXX]` tags in
the `tests` paths of the spec. If `spec-md` is not available, do it by hand: for
each spec, collect its Test IDs and run `grep -r "\[TC-"` across the `tests`
paths.

Then:

1. List each **uncovered** Test ID — a row with no matching `[TC-XXXX]` test.
2. List each **orphan tag** — a `[TC-XXXX]` in the tests that no spec declares.
   An orphan tag signals a row that the spec does not have.
3. For each gap, recommend the concrete next step: write the missing test with
   the tag, or add the missing TC row (generate a new id with `spec-md id`).
   Apply the update rules of the spec-md skill.

Summarize the result as a coverage table. Write a test or edit a spec only if I
ask.
