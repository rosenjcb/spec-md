---
description: Explore each spec's behavioral model and conformance-test the implementation against it.
argument-hint: "[check|test|list] [path] (defaults to check over the whole repo)"
allowed-tools: Bash(npx @rosenjcb/spec-md:*), Bash(node:*), Read, Grep, Glob
---

Work with the behavioral models under: **${ARGUMENTS:-the whole repository}**

The behavioral model is the executable layer of a spec: `state`, actions
(`AC-N`), invariants (`INV-N`), and behavioral properties (`BP-N`) in a fenced
` ```spec-model ` block. Tests protect examples; the model protects behavior.

Run the model tooling — `check` explores the model itself, `test` conformance-tests
the implementation through the model's `adapter`:

```
npx @rosenjcb/spec-md model ${ARGUMENTS:-check .}
```

If the arguments name no subcommand, run `model check` first, then `model test`
when a model declares an `adapter`. Use `model list` when I want to see the
contract rather than verify it.

Then report, per model:

1. **Violations** — each is a minimal counterexample: the initial state, the
   action sequence, and the invariant or property that broke. Say whether the
   *model* is wrong or the *implementation* is, and why. Never propose loosening
   an invariant just to make the check pass.
2. **Conformance failures** — quote the expected vs. observed state and the
   contract rows involved, then give the two resolutions explicitly: restore the
   implementation, or update the `FR-N`/`AC-N` and add the `TC-N` that pins the
   new boundary.
3. **Unexercised properties** — a `BP-N` nothing triggered within the bounds
   proves nothing; suggest a higher `--depth` or a wider domain. Note when a run
   stopped at `--max-states`: it was not exhaustive.
4. **Coverage gaps** — requirements with no model element, and model elements
   citing no `FR-N`.

Summarize first. Only edit specs, models, adapters, or code if I ask.

Full reference: https://github.com/rosenjcb/spec.md/blob/main/MODELS.md
