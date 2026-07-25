<div align="center">

<h1>Adopting spec.md</h1>

<p><strong>Every way to get spec.md into your project</strong> — pick the row that matches your setup.</p>

</div>

spec.md ships in two layers you can mix and match:

1. **The skill** — the authoring guidance that teaches an agent to write and
   maintain `*.spec.md` files. Same content, packaged for each agent.
2. **The CLI** — `spec-md`, a zero-dependency validator/coverage tool that makes
   specs enforceable in CI.

| You use… | Install |
|----------|---------|
| **Claude Code** (plugin) | `/plugin marketplace add rosenjcb/spec.md` then `/plugin install spec-md@spec-md` |
| **Claude Code** (skill only) | `curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh \| bash` |
| **Cursor / Windsurf / Cline / Copilot** | `install.sh --cursor --windsurf --cline --copilot` (see below) |
| **Any agent** (portable) | drop [`AGENTS.md`](./AGENTS.md) at your repo root |
| **CI / command line** | `npm i -D @rosenjcb/spec-md` · `npx @rosenjcb/spec-md check` |

---

## 1. Claude Code plugin (recommended)

Installs the `/spec-md` skill **and** the `/spec-md:check` /
`/spec-md:coverage` commands in one step.

```
/plugin marketplace add rosenjcb/spec.md
/plugin install spec-md@spec-md
```

Then in any session:

```
/spec-md orders             # create or update — skill triages either way
/spec-md:check              # lint every spec in the repo
/spec-md:coverage           # which TC-N are missing a [TC-N] test?
```

Authoring is just `/spec-md` — the skill. It looks for an existing
`*.spec.md` first (update) or writes a new one (create). Only `:check` and
`:coverage` are extra slash commands.

## 2. Claude Code skill only

If you just want the authoring guidance (no commands), the installer copies the
skill into `~/.claude/skills/spec-md/` (it links to the companion
[`TESTING.md`](./TESTING.md) rather than bundling a copy of it):

```bash
# global (default)
curl -fsSL https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.sh | bash

# project-local: writes ./.claude/skills/spec-md/
./install.sh --claude --local
```

## 3. Other agents

The same guidance is generated into each agent's native rule format. The
installer drops the right file into your project:

```bash
./install.sh --cursor      # .cursor/rules/spec-md.mdc
./install.sh --windsurf    # .windsurf/rules/spec-md.md
./install.sh --cline       # .clinerules/spec-md.md
./install.sh --copilot     # .github/copilot-instructions.md
./install.sh --agents      # AGENTS.md (portable; Codex, Jules, and others)
./install.sh --all         # every one of the above
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/rosenjcb/spec.md/main/install.ps1 | iex
# or, from a checkout:
./install.ps1 -All
```

Prefer to commit the files yourself? They already live in this repo under
`.cursor/`, `.windsurf/`, `.clinerules/`, `.github/`, and `AGENTS.md` — copy the
one you need. All of them are generated from `SKILL.md`, so they never drift.

## 4. The CLI

```bash
npx @rosenjcb/spec-md lint            # validate frontmatter + FR/TC structure
npx @rosenjcb/spec-md coverage        # TC-N ↔ [TC-N] test coverage
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
```

Or skip the action and run the CLI directly: `npx @rosenjcb/spec-md check --strict`.

---

## Keeping the adapters in sync (maintainers)

`SKILL.md` is the single source of truth. The agent adapters and the plugin's
skill copy are generated:

```bash
pnpm run sync         # regenerate every adapter from SKILL.md
pnpm run sync:check   # verify they are up to date (runs in CI)
```

Never edit a generated file by hand — change `SKILL.md` and re-run `pnpm run sync`.

Releases (npm, tags, GitHub Action): see **[RELEASING.md](./RELEASING.md)**.
