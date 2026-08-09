# Releasing spec-md

Automated releases follow the [Changesets](https://github.com/changesets/changesets) flow used in [rosenjcb/kb](https://github.com/rosenjcb/kb): version on the PR branch, tag + publish on merge to `main`.

Repo tooling uses **pnpm** (`pnpm-workspace.yaml`). Consumers still install the CLI from npm (`npm i -D @rosenjcb/spec-md` / `npx`).

## What is automated

| Step | When | Workflow |
|------|------|----------|
| Version bump gate | PR into `main` | `specs.yml` → **Version bump required** |
| Publish target validation | Every CI run | `pnpm run publish:check` |
| Git tag `v{version}` | Merge to `main` | `changesets.yml` |
| npm publish | Merge to `main` (new tag) | `changesets.yml` |
| GitHub Release | Merge to `main` (new tag) | `changesets.yml` |

Tagging, npm publish, and the GitHub Release all run in the **same** `changesets.yml`
job on merge to `main`. They are not split into a separate tag-triggered workflow
because a tag pushed with the default `GITHUB_TOKEN` does not trigger other
workflows — so a `on: push: tags` release job would never fire. The publish/release
steps are gated on the tag being newly created, so re-running on `main` without a
version bump is a no-op.

## What stays manual (one-time)

### 1. npm — the `NPM_TOKEN` secret

`@rosenjcb/spec-md` is already published (`npm view @rosenjcb/spec-md version`).
The one thing CI needs in order to publish future versions automatically is an
npm token in repo secrets. Without it, the **Publish to npm** step in
`changesets.yml` fails and releases stay manual.

**One-time setup:**

1. Create a token that works from CI (bypasses 2FA):
   - **Granular Access Token** (recommended) scoped to `@rosenjcb/spec-md` with
     **Read and write** on packages, or
   - a classic **Automation** token.

   npmjs.com → avatar → **Access Tokens** → **Generate New Token**.

2. Add it to GitHub repo secrets as **`NPM_TOKEN`**:
   - Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - Name: `NPM_TOKEN`
   - Value: your npm token

After this, `changesets.yml` publishes every new version automatically on merge to
`main`.

**If you ever need the very first publish by hand** (new scope/package):
```bash
npm login   # account must own the @rosenjcb scope
cd cli
npm publish --access public
```

### 2. GitHub Action Marketplace — first release

GitHub does **not** expose an API for the "Publish to Marketplace" checkbox (2FA / developer agreement).

**One-time setup:**

1. Open [github.com/rosenjcb/spec.md/releases/new](https://github.com/rosenjcb/spec.md/releases/new)

2. If prompted, accept the **GitHub Marketplace Developer Agreement** (repo owner only).

3. Create release **`v0.2.0`** targeting `main`:
   - Tag: `v0.2.0`
   - Title: `@rosenjcb/spec-md v0.2.0`
   - Check **Publish this Action to the GitHub Marketplace**
   - Primary category: **AI Assisted** (or your preference)

4. Click **Publish release**.

If `changesets.yml` already created the `v0.2.0` tag when you merge this PR, edit that release in the UI and enable marketplace publishing instead of creating a duplicate.

**Every later version:** `release.yml` creates the GitHub Release. You still need to open each new release and check **Publish to Marketplace** until GitHub adds API support.

### 3. Claude Code plugin — nothing to publish

`.claude-plugin/marketplace.json` is served from the public GitHub repo. Users install with:

```
/plugin marketplace add rosenjcb/spec.md
/plugin install spec-md@spec-md
```

No separate platform upload. `pnpm run changeset:version` keeps plugin version fields in sync with the CLI.

---

## Day-to-day release workflow

### Ship a change that affects the CLI or Action

1. **Add a changeset** — create `.changeset/your-change.md`:
   ```md
   ---
   "@rosenjcb/spec-md": patch
   ---

   Short summary of the change.
   ```

2. **Apply the bump** on your branch:
   ```bash
   pnpm install
   pnpm run changeset:version
   ```
   This bumps `cli/package.json`, writes `cli/CHANGELOG.md`, and syncs plugin manifests.

3. **Verify locally:**
   ```bash
   node scripts/check-changeset-consistency.mjs --base origin/main
   pnpm run publish:check
   pnpm test
   ```

4. **Open PR → merge to `main`.**

5. CI on `main` (`changesets.yml`) tags `v{new-version}`. The same run publishes to npm and creates the GitHub Release.

### Docs-only / SKILL.md changes

You do not need a version bump if you did not change `cli/` or `action.yml`. You must still run `pnpm run sync` for the adapters.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Version bump required` CI failed | Add changeset + run `pnpm run changeset:version`, commit |
| `publish:check` version mismatch | Run `pnpm run changeset:version` or `node scripts/sync-versions.mjs` |
| `publish:check --check-npm` fails right after publish | Registry lag; the check queries the exact version (not `latest`) and retries. Re-run the job if it still fails after a minute. |
| `NPM_TOKEN` missing in release | Add secret (step 1 above) |
| npm 404 on `npx @rosenjcb/spec-md` | First publish not done yet (step 1 above) |
| Tag exists but no GitHub Release / npm package | Tag was created without the publish steps (or verify used to block the release). Create the release from the tag in the GitHub UI, or `npm publish` from `cli/` if the version is missing on npm. |
| Action works on `@main` but not Marketplace | First marketplace release not published (step 2 above) |
| Tag already exists | Expected when re-running `main` without a version bump; publish/release steps skip (no-op) |

## Branch protection (recommended)

Mark these checks as **required** on `main`:

- **lint, test, and coverage**
- **Version bump required**
