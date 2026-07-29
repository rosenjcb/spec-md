<div align="center">

<h1>Adopting spec.md</h1>

<p><strong>Every way to get spec.md into your project</strong> — pick the row that matches your setup.</p>

</div>

spec.md ships in two layers you can mix and match:

1. **The skill** — the authoring guidance that teaches an agent to write and
   maintain `*.spec.md` files. Same content, packaged for each agent as
   `spec-md` (invoke as `/spec-md`).
2. **The CLI** — `spec-md`, a zero-dependency validator, coverage tool, and
   behavioral-model checker that makes specs enforceable in CI.

| You use… | Install |
|----------|---------|
| **Claude Code** (plugin) | `/plugin marketplace add rosenjcb/spec.md` then `/plugin install spec-md@spec-md` |
| **Claude Code** (skill only) | `curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh \| bash` |
| **Cursor** | `./install.sh --cursor` → rule + `.agents/skills/spec-md` |
| **Codex / portable** | `./install.sh --agents` → `AGENTS.md` + `.agents/skills/spec-md` |
| **Windsurf / Cline / Copilot** | `./install.sh --windsurf` / `--cline` / `--copilot` |
| **CI / command line** | `npm i -D @rosenjcb/spec-md` · `npx @rosenjcb/spec-md check` |

Default `curl … \| bash` = Claude skill (global) + `AGENTS.md` + `.agents/skills/spec-md`.
Use `--all` or explicit flags for the other agents. Prefer **plugin XOR skill-only**
for Claude — not both (duplicate `/spec-md` entries).

---

## 1. Claude Code plugin (recommended)

Root `SKILL.md` is the plugin's single skill (no nested `skills/spec-md/` copy).
Commands are only `:check`, `:coverage`, and `:model`.

```
/plugin marketplace add rosenjcb/spec.md
/plugin install spec-md@spec-md
```

Then in any session:

```
/spec-md orders             # create or update — skill triages either way
/spec-md:check              # lint every spec in the repo
/spec-md:coverage           # which TC-N are missing a [TC-N] test?
/spec-md:model              # explore + conformance-test behavioral models
```

Authoring is `/spec-md`. Claude may also list a namespaced form of the same
skill; use the bare `/spec-md`. Do not install the skill a second time via
`install.sh --claude` if the plugin is already enabled.

## 2. Claude Code skill only

Authoring guidance without the plugin commands — copies into
`~/.claude/skills/spec-md/` (invoke as `/spec-md`):

```bash
# global (default) — also writes AGENTS.md + .agents/skills/spec-md into cwd
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh | bash

# project-local Claude skill only:
./install.sh --claude --local
```

## 3. Cursor, Codex, and other agents

Same skill id everywhere: **`spec-md`** → invoke as **`/spec-md`**.

| Flag | What lands in the project |
|------|---------------------------|
| `--cursor` | `.cursor/rules/spec-md.mdc` + `.agents/skills/spec-md/SKILL.md` |
| `--agents` | `AGENTS.md` + `.agents/skills/spec-md/SKILL.md` (Codex, Jules, …) |
| `--windsurf` | `.windsurf/rules/spec-md.md` |
| `--cline` | `.clinerules/spec-md.md` |
| `--copilot` | `.github/copilot-instructions.md` |
| `--all` | every row above (+ Claude skill) |

```bash
./install.sh --cursor
./install.sh --agents
./install.sh --all
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.ps1 | iex
# or, from a checkout:
./install.ps1 -All
```

Prefer to commit the files yourself? They live in this repo under
`.agents/skills/spec-md/`, `.cursor/`, `.windsurf/`, `.clinerules/`,
`.github/`, and `AGENTS.md`. All generated from root `SKILL.md`.

`.agents/skills/` is the [Agent Skills](https://agentskills.io) path — Cursor and
Codex both load it. There is no nested Claude `skills/spec-md/` directory in the
plugin (that double-named the slash form).

## 4. The CLI

```bash
npx @rosenjcb/spec-md lint            # validate frontmatter + FR/TC/model structure
npx @rosenjcb/spec-md coverage        # TC-N ↔ [TC-N] test coverage
npx @rosenjcb/spec-md check --strict  # all three, as a CI gate
npx @rosenjcb/spec-md model check     # explore each behavioral model
npx @rosenjcb/spec-md model test      # conformance: implementation vs. model
npx @rosenjcb/spec-md new billing     # scaffold billing.spec.md
npx @rosenjcb/spec-md list            # every spec, with counts + coverage
```

The behavioral model layer is optional; the full reference is
[MODELS.md](./MODELS.md).

Install it as a dev dependency to pin the version:

```bash
npm install --save-dev @rosenjcb/spec-md
```

Full command reference: [`cli/README.md`](./cli/README.md).

## 5. Continuous integration

Use the bundled GitHub Action to fail a build when a spec breaks or a `TC-N`
loses its test:

```yaml
# .github/workflows/specs.yml
name: specs
on: [push, pull_request]
jobs:
  spec-md:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: rosenjcb/spec.md@main
        with:
          path: .
          strict: "true"
          # conform: "true"   # also conformance-test behavioral models
```

Or skip the action and run the CLI directly: `npx @rosenjcb/spec-md check --strict`.

---

## Keeping the adapters in sync (maintainers)

`SKILL.md` (repo root) is the single source of truth **and** the Claude plugin
skill. Adapters are generated:

```bash
pnpm run sync         # regenerate every adapter from SKILL.md
pnpm run sync:check   # verify they are up to date (runs in CI)
```

Never edit a generated file by hand — change `SKILL.md` and re-run `pnpm run sync`.
Do not reintroduce `skills/<name>/` under the plugin root.

Releases (npm, tags, GitHub Action): see **[RELEASING.md](./RELEASING.md)**.
