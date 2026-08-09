/**
 * Release metadata for spec-md.
 *
 * Shipped releases follow `@rosenjcb/spec-md` (version + changelog + git tags).
 * Root `spec-md` is private; Claude plugin manifests mirror the CLI version.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = path.resolve(scriptDir, '..')

export const CLI_PKG_DIR = path.join(REPO_ROOT, 'cli')
export const CLI_PKG_JSON = path.join(CLI_PKG_DIR, 'package.json')
export const CLI_CHANGELOG = path.join(CLI_PKG_DIR, 'CHANGELOG.md')

export const NPM_PACKAGE = '@rosenjcb/spec-md'

/** @param {string} pkgJsonPath */
export function readPackageVersion(pkgJsonPath) {
  const { version } = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
  if (!version || typeof version !== 'string') {
    throw new Error(`Missing version in ${pkgJsonPath}`)
  }
  return version
}

export function readCliVersion() {
  return readPackageVersion(CLI_PKG_JSON)
}

export function releaseTag(version) {
  return `v${version}`
}
