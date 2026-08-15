<div align="center">

<h1>Adopting spec-md</h1>

<p><strong>Every way to get spec-md into your project</strong> — pick the row that matches your setup.</p>

</div>

spec-md ships in two layers, and you can use one or both:

1. **The skill** — the authoring guidance that teaches an agent to write and
   maintain `*.spec.md` files, in the sections, the id rules, and the
   [Simplified Technical English](./README.md#the-language) house style of the
   standard. It is the same content, packaged for each agent as `spec-md`
   (invoke it as `/spec-md`).
2. **The CLI** — `spec-md`, a validator and coverage tool with no dependencies,
   which makes specs enforceable in CI.

| You use… | Install |
|----------|---------|
| **Claude Code** (plugin) | `/plugin marketplace add rosenjcb/spec.md` then `/plugin install spec-md@spec-md` |
| **Claude Code** (skill only) | `curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh \| bash` |
| **Cursor** | `./install.sh --cursor` → rule + `.agents/skills/spec-md` |
| **Codex / portable** | `./install.sh --agents` → `AGENTS.md` + `.agents/skills/spec-md` |
| **Windsurf / Cline / Copilot** | `./install.sh --windsurf` / `--cline` / `--copilot` |
| **CI / command line** | `npm i -D @rosenjcb/spec-md` · `npx @rosenjcb/spec-md check` |

Default `curl … \| bash` = Claude skill (global) + `AGENTS.md` + `.agents/skills/spec-md`.
Use `--all` or explicit flags for the other agents. For Claude, install **the
plugin or the skill, but not both**, because both together give you duplicate
`/spec-md` entries.

---

## 1. Claude Code plugin (recommended)

Root `SKILL.md` is the plugin's single skill — no `commands/` directory and no
nested `skills/spec-md/` copy — so it surfaces as the bare `/spec-md`, with no
colon-suffixed sub-commands.

```
/plugin marketplace add rosenjcb/spec.md
/plugin install spec-md@spec-md
```

Then in any session, one command does every job:

```
/spec-md orders             # author or update — the skill triages either way
/spec-md check the specs    # lint every spec in the repo
/spec-md coverage           # which Test IDs are missing a [TC-XXXX] test?
```

`/spec-md` is one skill that does three jobs — author or update, check, and
coverage. It works out which job you want from your request, and presents the
options when the intent is unclear. Do not install the skill a second time with
`install.sh --claude` if the plugin is already enabled.

## 2. Claude Code skill only

The same single skill without the plugin wrapper — copies into
`~/.claude/skills/spec-md/` (invoke as `/spec-md`):

```bash
# global (default) — also writes AGENTS.md + .agents/skills/spec-md into cwd
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh | bash

# project-local Claude skill only:
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh | bash -s -- --claude --local
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

The `./install.sh` form assumes you have the script locally. Download it once,
make it executable, then run it with whatever flags you want:

```bash
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh -o install.sh
chmod +x install.sh
./install.sh --cursor
./install.sh --agents
./install.sh --all
```

Prefer a one-liner? Pipe the flags straight through `bash` — no download step:

```bash
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh | bash -s -- --cursor
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh | bash -s -- --all
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.ps1 | iex
# or, from a checkout:
./install.ps1 -All
```

Do you prefer to commit the files yourself? They are in this repo under
`.agents/skills/spec-md/`, `.cursor/`, `.windsurf/`, `.clinerules/`,
`.github/`, and `AGENTS.md`. The sync script generates all of them from the
root `SKILL.md`.

`.agents/skills/` is the [Agent Skills](https://agentskills.io) path — Cursor and
Codex both load it. There is no nested Claude `skills/spec-md/` directory in the
plugin (that double-named the slash form).

## 4. The CLI

```bash
npx @rosenjcb/spec-md lint            # validate frontmatter + FR/TC structure
npx @rosenjcb/spec-md coverage        # Test ID ↔ [TC-XXXX] test coverage
npx @rosenjcb/spec-md check --strict  # both, as a CI gate
npx @rosenjcb/spec-md new billing     # scaffold billing.spec.md
npx @rosenjcb/spec-md list            # every spec, with counts + coverage
```

Install it as a dev dependency to pin the version:

```bash
npm install --save-dev @rosenjcb/spec-md
```

Full command reference: [`cli/README.md`](./cli/README.md).

## 5. Continuous integration

Use the bundled GitHub Action to fail a build when a spec breaks or a Test ID
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

Never edit a generated file by hand. Change `SKILL.md` and run `pnpm run sync`
again. Do not add a `skills/<name>/` directory under the plugin root.

Releases (npm, tags, GitHub Action): see **[RELEASING.md](./RELEASING.md)**.
