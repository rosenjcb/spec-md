---
"@rosenjcb/spec-md": minor
---

Replace sequential TC-N test-case ids with stable opaque TC-XXXX identifiers. lint validates format and uniqueness only (no contiguous order for TC); coverage matches [TC-XXXX] tags; new generates stable ids; add `spec-md id` and `spec-md migrate-ids` for allocation and one-shot migration of legacy tables.

Brand the product as **spec-md** (hyphen) everywhere except the `*.spec.md` file extension and the existing GitHub repo path `rosenjcb/spec.md`, so skill/plugin ids stay regex-friendly.
