---
description: Validate every *.spec.md in the repo — frontmatter, FR/TC structure, and id integrity.
argument-hint: "[path] (defaults to the whole repo)"
allowed-tools: Bash(npx @rosenjcb/spec-md:*), Bash(node:*), Read, Grep
---

Validate the specs under: **${ARGUMENTS:-the whole repository}**

Run the spec-md linter:

```
npx @rosenjcb/spec-md lint ${ARGUMENTS:-.}
```

If `spec-md` is not installed, read each `*.spec.md` and check it by hand:

- Frontmatter has `type: Spec` and a `title`.
- `FR-N` ids are unique, well-formed, **contiguous**, and **ascending**
  (`FR-1..FR-n` in table order — no skips).
- Test IDs use the stable form `TC-[A-Z0-9]{4}`, are unique within the spec,
  and are **not** sequence numbers. Do not require contiguous order for TC.
- Every Test ID cites a `Requirement` that exists as an `FR-N` row.
- `sources`/`tests` paths resolve on disk.

Group the results by file. For each **error**, propose the fix: reorder and
renumber FR rows as needed; for TC, fix format/uniqueness only — never renumber
stable ids. Do not edit a spec unless I ask. Summarize first.
