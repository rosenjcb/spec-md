---
description: Author or update a *.spec.md — triage first so create vs update is automatic.
argument-hint: <domain, path, or .spec.md file>
---

Author a `*.spec.md` for: **$ARGUMENTS**

Use the **spec-md** skill. **Always triage first** (skill Step 0) — do not
assume create or update:

1. **Create or update?** Search for an existing `*.spec.md` covering this
   domain (path hint, `npx @rosenjcb/spec-md list`, or `*.spec.md` under the
   target area). Found one → update path (Step 2u). None → create path
   (Step 2). If `$ARGUMENTS` is empty or ambiguous, ask which domain — then
   look before writing.
2. **Review?** From the request's scale, decide whether stakeholder sign-off
   is needed — classify when clear, ask only when not.

Then follow the skill for the chosen path (gather context from real code and
tests; write or edit in place; keep `FR-N` / `TC-N` contiguous and ascending;
link a `*.review.md` only when triage said so). Never invent structure the
code does not have. Never flip a review to `approved` without the user's word.

Finish by running `npx @rosenjcb/spec-md check <file>` (or `lint` on a brand-new
draft) and resolving errors or coverage gaps.
