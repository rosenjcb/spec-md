#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  evaluateChangesetConsistency,
  isSingleSemverStep,
  shippedSourceChanged,
} from '../check-changeset-consistency.mjs'
import { evaluatePublishTargets } from '../check-publish-targets.mjs'
import { extractChangelogSection } from '../extract-changelog.mjs'
import {
  readPackageVersion,
  releaseTag,
  REPO_ROOT,
} from '../release-package.mjs'
import { syncVersions } from '../sync-versions.mjs'
import {
  buildAdapterOutputs,
  splitSkillMarkdown,
  syncAdapters,
} from '../sync-adapters.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (e) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}`)
  }
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'spec-md-scripts-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function writePublishFixture(dir, version, overrides = {}) {
  mkdirSync(join(dir, 'cli'), { recursive: true })
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })

  writeFileSync(
    join(dir, 'cli/package.json'),
    `${JSON.stringify({ name: '@rosenjcb/spec-md', version }, null, 2)}\n`
  )
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'spec.md', version: overrides.rootVersion ?? version }, null, 2)}\n`
  )
  writeFileSync(
    join(dir, '.claude-plugin/plugin.json'),
    `${JSON.stringify(
      {
        name: 'spec-md',
        description: 'plugin',
        version: overrides.pluginVersion ?? version,
      },
      null,
      2
    )}\n`
  )
  writeFileSync(
    join(dir, '.claude-plugin/marketplace.json'),
    `${JSON.stringify(
      {
        name: 'spec-md',
        owner: { name: 'rosenjcb' },
        metadata: { version: overrides.marketplaceVersion ?? version },
        plugins: [
          {
            name: 'spec-md',
            source: './',
            version: overrides.pluginEntryVersion ?? version,
          },
        ],
      },
      null,
      2
    )}\n`
  )
  writeFileSync(
    join(dir, 'action.yml'),
    `runs:\n  using: composite\n  steps:\n    - run: npx @rosenjcb/spec-md@latest\n`
  )
  writeFileSync(
    join(dir, 'README.md'),
    `<img src="https://img.shields.io/badge/version-${version.replace(/\.0$/, '')}-6366F1" />\n`
  )
}

console.log('scripts tests\n')

console.log('check-changeset-consistency')
test('isSingleSemverStep accepts patch, minor, and major', () => {
  assert.ok(isSingleSemverStep('1.2.3', '1.2.4'))
  assert.ok(isSingleSemverStep('1.2.3', '1.3.0'))
  assert.ok(isSingleSemverStep('1.2.3', '2.0.0'))
  assert.equal(isSingleSemverStep('1.2.3', '1.2.5'), false)
  assert.equal(isSingleSemverStep('1.2.3', '1.2.3'), false)
})

test('shippedSourceChanged ignores docs and CHANGELOG', () => {
  assert.equal(shippedSourceChanged(['SKILL.md', 'README.md']), false)
  assert.equal(shippedSourceChanged(['cli/CHANGELOG.md']), false)
  assert.equal(shippedSourceChanged(['cli/test/run.js']), false)
  assert.equal(shippedSourceChanged(['scripts/test/run.js']), false)
  assert.equal(shippedSourceChanged(['examples/pizza-ts/specs/order.spec.md']), false)
  assert.equal(shippedSourceChanged(['cli/lib/lint.js']), true)
  assert.equal(shippedSourceChanged(['action.yml']), true)
})

test('evaluateChangesetConsistency exempts docs-only PRs', () => {
  const result = evaluateChangesetConsistency({
    changedFiles: ['RELEASING.md', 'SKILL.md'],
    pendingChangesets: [],
    cli: { base: '0.2.0', head: '0.2.0' },
  })
  assert.equal(result.ok, true)
  assert.match(result.notes.join(' '), /not required/)
})

test('evaluateChangesetConsistency requires applied bump for cli changes', () => {
  const pending = evaluateChangesetConsistency({
    changedFiles: ['cli/lib/lint.js'],
    pendingChangesets: ['.changeset/foo.md'],
    cli: { base: '0.2.0', head: '0.2.0' },
  })
  assert.equal(pending.ok, false)
  assert.match(pending.errors.join(' '), /Pending changeset not applied/)

  const unbumped = evaluateChangesetConsistency({
    changedFiles: ['cli/lib/lint.js'],
    pendingChangesets: [],
    cli: { base: '0.2.0', head: '0.2.0' },
  })
  assert.equal(unbumped.ok, false)
  assert.match(unbumped.errors.join(' '), /version is still/)

  const bumped = evaluateChangesetConsistency({
    changedFiles: ['cli/lib/lint.js'],
    pendingChangesets: [],
    cli: { base: '0.2.0', head: '0.2.1' },
  })
  assert.equal(bumped.ok, true)
})

test('evaluateChangesetConsistency rejects double semver jumps', () => {
  const result = evaluateChangesetConsistency({
    changedFiles: ['cli/lib/lint.js'],
    pendingChangesets: [],
    cli: { base: '0.2.0', head: '0.4.0' },
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /more than one semver step/)
})

console.log('\ncheck-publish-targets')
test('evaluatePublishTargets passes on aligned fixture', () => {
  withTempDir(dir => {
    writePublishFixture(dir, '1.0.0')
    const result = evaluatePublishTargets({ root: dir })
    assert.equal(result.ok, true, result.errors.join('; '))
  })
})

test('evaluatePublishTargets fails on version drift', () => {
  withTempDir(dir => {
    writePublishFixture(dir, '1.0.0', { pluginVersion: '0.9.0' })
    const result = evaluatePublishTargets({ root: dir })
    assert.equal(result.ok, false)
    assert.match(result.errors.join(' '), /plugin\.json/)
  })
})

test('evaluatePublishTargets fails when marketplace shape is invalid', () => {
  withTempDir(dir => {
    writePublishFixture(dir, '1.0.0')
    writeFileSync(
      join(dir, '.claude-plugin/marketplace.json'),
      `${JSON.stringify({ name: 'spec-md', plugins: [] }, null, 2)}\n`
    )
    const result = evaluatePublishTargets({ root: dir })
    assert.equal(result.ok, false)
    assert.match(result.errors.join(' '), /plugins array is empty/)
  })
})

test('evaluatePublishTargets reports missing npm package', () => {
  withTempDir(dir => {
    writePublishFixture(dir, '1.0.0')
    const result = evaluatePublishTargets({ root: dir, checkNpm: true, npmLookupError: true })
    assert.equal(result.ok, false)
    assert.match(result.errors.join(' '), /@1\.0\.0 is not on npm yet/)
  })
})

test('evaluatePublishTargets accepts matching npm version', () => {
  withTempDir(dir => {
    writePublishFixture(dir, '1.0.0')
    const result = evaluatePublishTargets({ root: dir, checkNpm: true, npmVersion: '1.0.0' })
    assert.equal(result.ok, true, result.errors.join('; '))
    assert.match(result.notes.join(' '), /npm registry/)
  })
})

test('evaluatePublishTargets fails when exact npm version is absent', () => {
  withTempDir(dir => {
    writePublishFixture(dir, '1.0.0')
    const result = evaluatePublishTargets({ root: dir, checkNpm: true, npmVersion: null })
    assert.equal(result.ok, false)
    assert.match(result.errors.join(' '), /@1\.0\.0 is not on npm yet/)
  })
})

test('real repo passes publish target validation', () => {
  const result = evaluatePublishTargets({ root: REPO_ROOT })
  assert.equal(result.ok, true, result.errors.join('; '))
})

console.log('\nextract-changelog')
test('extractChangelogSection returns the requested version body', () => {
  const changelog = `# Changelog\n\n## 1.0.0\n\n### Added\n- one\n\n## 0.9.0\n\n### Fixed\n- two\n`
  assert.match(extractChangelogSection(changelog, '1.0.0'), /Added/)
  assert.doesNotMatch(extractChangelogSection(changelog, '1.0.0'), /Fixed/)
  assert.match(extractChangelogSection(changelog, 'v0.9.0'), /Fixed/)
})

test('extractChangelogSection returns first section when version omitted', () => {
  const changelog = `## 2.0.0\n\nAlpha\n\n## 1.0.0\n\nBeta\n`
  assert.equal(extractChangelogSection(changelog), 'Alpha')
})

test('extractChangelogSection returns empty for unknown version', () => {
  assert.equal(extractChangelogSection('## 1.0.0\n\nBody\n', '9.9.9'), '')
})

console.log('\nrelease-package')
test('readPackageVersion reads semver from package.json', () => {
  withTempDir(dir => {
    const pkg = join(dir, 'package.json')
    writeFileSync(pkg, '{"version":"3.4.5"}\n')
    assert.equal(readPackageVersion(pkg), '3.4.5')
  })
})

test('readPackageVersion throws when version missing', () => {
  withTempDir(dir => {
    const pkg = join(dir, 'package.json')
    writeFileSync(pkg, '{}\n')
    assert.throws(() => readPackageVersion(pkg), /Missing version/)
  })
})

test('releaseTag prefixes v', () => {
  assert.equal(releaseTag('1.2.3'), 'v1.2.3')
})

console.log('\nsync-versions')
test('syncVersions mirrors cli version into consumer manifests', () => {
  withTempDir(dir => {
    writePublishFixture(dir, '1.0.0', {
      rootVersion: '0.5.0',
      pluginVersion: '0.5.0',
      marketplaceVersion: '0.5.0',
      pluginEntryVersion: '0.5.0',
    })
    writeFileSync(join(dir, 'cli/package.json'), '{"name":"@rosenjcb/spec-md","version":"2.0.0"}\n')
    writeFileSync(
      join(dir, 'README.md'),
      '<img src="https://img.shields.io/badge/version-0.5-6366F1" />\n'
    )

    const { version, updated } = syncVersions(dir)
    assert.equal(version, '2.0.0')
    assert.ok(updated.includes('package.json'))
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, '2.0.0')
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /version-2\.0-/)
  })
})

console.log('\nsync-adapters')
test('splitSkillMarkdown parses frontmatter and body', () => {
  const { fm, body } = splitSkillMarkdown('---\ntitle: Demo\ntype: Spec\n---\n\nBody text\n')
  assert.equal(fm.title, 'Demo')
  assert.equal(fm.type, 'Spec')
  assert.match(body, /Body text/)
})

test('buildAdapterOutputs stamps generated banner into AGENTS.md', () => {
  const skill = '---\ntitle: Demo\ndescription: Teach agents\n---\n\nRules here\n'
  const agents = buildAdapterOutputs(skill).find(t => t.path === 'AGENTS.md')
  assert.ok(agents)
  assert.match(agents.content, /GENERATED FROM SKILL.md/)
  assert.match(agents.content, /Rules here/)
})

test('syncAdapters writes adapter files from SKILL.md', () => {
  withTempDir(dir => {
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\ntitle: Demo\ndescription: Teach agents\n---\n\nAdapter body\n'
    )
    const { wrote } = syncAdapters(dir)
    assert.ok(wrote > 0)
    assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /Adapter body/)
  })
})

test('syncAdapters --check reports drift', () => {
  withTempDir(dir => {
    writeFileSync(join(dir, 'SKILL.md'), '---\ntitle: Demo\n---\n\nBody\n')
    syncAdapters(dir)
    writeFileSync(join(dir, 'AGENTS.md'), 'stale\n')
    const { drift } = syncAdapters(dir, { check: true })
    assert.ok(drift.includes('AGENTS.md'))
  })
})

test('real repo adapters are in sync with SKILL.md', () => {
  const { drift } = syncAdapters(root, { check: true })
  assert.deepEqual(drift, [])
})

console.log('\nplugin invocation nomenclature')
/**
 * Claude Code invokes plugin commands as `/<plugin.name>:<filename-stem>`.
 * Filenames must be action-only (update.md → /spec-md:update). Putting
 * `spec` or `spec-md` in the filename produces /spec-md:spec-update — the
 * bug we already shipped once. Do not "fix" this by renaming to
 * spec:update.md; colons in filenames are not a substitute for the plugin
 * namespace.
 */
const EXPECTED_COMMAND_FILES = ['check.md', 'coverage.md', 'create.md', 'update.md']
const EXPECTED_INVOCATIONS = [
  '/spec-md:check',
  '/spec-md:coverage',
  '/spec-md:create',
  '/spec-md:update',
]
const FORBIDDEN_INVOCATION_SUBSTRINGS = [
  '/spec:update',
  '/spec:check',
  '/spec:coverage',
  '/spec-update',
  '/spec-check',
  '/spec-coverage',
  '/spec-md:new',
  // Double-prefixed command stems under plugin `spec-md` (not the skill
  // `/spec-md:spec-md`, which is legitimate to document).
  '/spec-md:spec-update',
  '/spec-md:spec-check',
  '/spec-md:spec-coverage',
  '/spec-md:spec:',
  '/spec-md:spec.',
  '`/spec`',
  '/spec orders',
  '/spec ',
]

test('command files are action-only; plugin+skill brand is spec-md', () => {
  const files = readdirSync(join(root, 'commands'))
    .filter(f => f.endsWith('.md'))
    .sort()
  assert.deepEqual(
    files,
    EXPECTED_COMMAND_FILES,
    `commands/*.md must be exactly ${EXPECTED_COMMAND_FILES.join(', ')} — ` +
      `Claude maps each to /spec-md:<stem>`
  )

  for (const file of files) {
    assert.equal(file.includes(':'), false, `${file}: no colon in filename`)
    assert.equal(
      /^(spec|spec-md)[-.]/.test(file),
      false,
      `${file}: must not start with spec-/spec-md- (double-prefix under plugin spec-md)`
    )
  }

  const plugin = JSON.parse(
    readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')
  )
  assert.equal(plugin.name, 'spec-md')

  const marketplace = JSON.parse(
    readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8')
  )
  assert.equal(marketplace.name, 'spec-md')
  assert.equal(marketplace.plugins[0]?.name, 'spec-md')

  const skillRaw = readFileSync(join(root, 'SKILL.md'), 'utf8')
  const { fm } = splitSkillMarkdown(skillRaw)
  assert.equal(fm.name, 'spec-md')

  const pluginSkill = readFileSync(join(root, 'skills/spec-md/SKILL.md'), 'utf8')
  assert.equal(splitSkillMarkdown(pluginSkill).fm.name, 'spec-md')

  // Derive the live invocation strings from disk — do not hardcode a second map.
  const derived = files.map(f => `/${plugin.name}:${f.replace(/\.md$/, '')}`).sort()
  assert.deepEqual(derived, [...EXPECTED_INVOCATIONS].sort())
})

test('docs and manifests advertise /spec-md:<action>, not stale /spec:* forms', () => {
  const surfaces = [
    'README.md',
    'INSTALL.md',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'commands/create.md',
  ]
  for (const rel of surfaces) {
    const text = readFileSync(join(root, rel), 'utf8')
    for (const inv of EXPECTED_INVOCATIONS) {
      // create.md only needs to mention update as the sibling command
      if (rel === 'commands/create.md' && inv !== '/spec-md:update') continue
      assert.ok(
        text.includes(inv),
        `${rel} must mention ${inv}`
      )
    }
    for (const bad of FORBIDDEN_INVOCATION_SUBSTRINGS) {
      assert.equal(
        text.includes(bad),
        false,
        `${rel} still advertises forbidden form ${JSON.stringify(bad)}`
      )
    }
  }
})

console.log('\nscript CLIs')
test('check-changeset-consistency --assert-no-pending exits 0 on clean repo', () => {
  const out = execFileSync('node', ['scripts/check-changeset-consistency.mjs', '--assert-no-pending'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  })
  assert.match(out, /No pending changesets/)
})

test('extract-changelog CLI prints section for current version', () => {
  const version = JSON.parse(readFileSync(join(root, 'cli/package.json'), 'utf8')).version
  const out = execFileSync('node', ['scripts/extract-changelog.mjs', version], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.match(out, /Initial release|### (Major|Minor|Patch) Changes/)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
