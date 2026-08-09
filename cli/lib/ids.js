import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { TC_ID_RE, parseSpec, pathList } from "./parse.js";
import { expandPath } from "./walk.js";

export { TC_ID_RE };

/** Legacy sequential id (`TC-1`, `TC-12`, …) still rewritten by migrate-ids. */
export const LEGACY_TC_ID_RE = /^TC-\d+$/;

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TEXT_EXT =
  /\.(m?[jt]sx?|py|rb|go|rs|java|kt|cs|php|swift|scala|clj|ex|exs|http|feature|md|txt|sh|c|cc|cpp|h|hpp|sql|yaml|yml)$/i;

/** True when `id` matches the stable TC format. */
export function isValidTcId(id) {
  return typeof id === "string" && TC_ID_RE.test(id);
}

/** True when `id` is a legacy sequential TC-N. */
export function isLegacyTcId(id) {
  return typeof id === "string" && LEGACY_TC_ID_RE.test(id);
}

/**
 * Canonical seed for a new test case.
 * Uses requirement + scenario only so Expected Outcome can change freely.
 * Implementation detail: not part of the public identifier semantics.
 */
export function tcIdentitySeed(requirement, scenario) {
  const req = String(requirement ?? "").replace(/\[(REMOVED|NEW|UPDATED)\]/g, "").trim();
  const scen = String(scenario ?? "").replace(/\[(REMOVED|NEW|UPDATED)\]/g, "").trim();
  return `${req}|${scen}`;
}

/** Hash `input` to a four-character uppercase base36 suffix. */
function hashSuffix(input) {
  const digest = createHash("sha256").update(input, "utf8").digest();
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    value = (value << 8n) | BigInt(digest[i]);
  }
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix = BASE36[Number(value % 36n)] + suffix;
    value /= 36n;
  }
  return suffix;
}

/**
 * Generate a candidate TC id from a seed, then resolve collisions.
 * Existing ids in `used` are never reused. Once written to a spec the id is
 * permanent — do not re-run this for rows that already have a valid id.
 *
 * @param {string} seed - Canonical identity seed (see `tcIdentitySeed`).
 * @param {Iterable<string>} [used] - IDs already present in the same spec.
 * @returns {string} e.g. `TC-K7MF`
 */
export function generateTcId(seed, used = []) {
  const occupied = new Set(used);
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const material = attempt === 0 ? String(seed) : `${seed}:${attempt}`;
    const id = `TC-${hashSuffix(material)}`;
    if (!occupied.has(id)) return id;
  }
  throw new Error(`Could not allocate a free TC id for seed "${seed}"`);
}

/**
 * Plan migrations for one parsed spec.
 * Returns { mapping: Map old->new, collisions: string[], changes: number }.
 * Pure: does not write files.
 */
export function planTcIdMigration(spec) {
  const mapping = new Map();
  const used = new Set();
  const collisions = [];

  // Keep every id that is already in stable form.
  for (const tc of spec.tcs) {
    if (isValidTcId(tc.id)) used.add(tc.id);
  }

  for (const tc of spec.tcs) {
    if (isValidTcId(tc.id)) {
      mapping.set(tc.id, tc.id);
      continue;
    }
    if (!isLegacyTcId(tc.id)) {
      // Malformed id: leave mapping empty for this key; migrate will fail.
      collisions.push(`Cannot migrate malformed test id "${tc.id}"`);
      continue;
    }
    const seed = tcIdentitySeed(tc.reqRaw || tc.requirements.join(","), tc.scenario);
    const next = generateTcId(seed, used);
    used.add(next);
    mapping.set(tc.id, next);
  }

  // Detect destination collisions among new ids (generateTcId already
  // avoids reusing `used`, but two seeds should never claim one target).
  const targets = new Map();
  for (const [from, to] of mapping) {
    if (from === to) continue;
    if (targets.has(to) && targets.get(to) !== from) {
      collisions.push(
        `Collision: both ${targets.get(to)} and ${from} migrate to ${to}`,
      );
    } else {
      targets.set(to, from);
    }
  }

  const changes = [...mapping].filter(([from, to]) => from !== to).length;
  return { mapping, collisions, changes };
}

/**
 * Rewrite every TC id key in `text` according to `mapping`.
 * Only replaces whole `TC-…` tokens that appear in the map, so
 * TC-1 does not clobber TC-10.
 */
export function rewriteTcIds(text, mapping) {
  if (!mapping.size) return text;
  return text.replace(/\bTC-(?:\d+|[A-Z0-9]{4})\b/g, (match) =>
    mapping.has(match) ? mapping.get(match) : match,
  );
}

/**
 * Paths that may contain `[TC-*]` tags for this spec.
 */
function testRootsForSpec(spec, filePath) {
  const dir = dirname(filePath);
  const declared = pathList(spec.frontmatter.tests).map((p) => resolve(dir, p));
  return declared.length ? declared : [dir];
}

/**
 * Migrate one spec (and its test trees) from sequential TC-N to stable ids.
 * Idempotent: already-stable specs write nothing.
 *
 * @returns {{ filePath, changed, mapping: Record<string,string>, files: string[] }}
 */
export function migrateSpecIds(filePath, { dryRun = false } = {}) {
  const spec = parseSpec(filePath);
  const { mapping, collisions, changes } = planTcIdMigration(spec);
  if (collisions.length) {
    const err = new Error(
      `Migration of ${filePath} aborted: ${collisions.join("; ")}`,
    );
    err.collisions = collisions;
    throw err;
  }

  if (changes === 0) {
    return {
      filePath,
      changed: false,
      mapping: Object.fromEntries(mapping),
      files: [],
    };
  }

  // Plan all rewrites before writing anything.
  const planned = [];
  const newSpecText = rewriteTcIds(spec.text, mapping);
  if (newSpecText !== spec.text) {
    planned.push({ path: filePath, text: newSpecText });
  }

  for (const root of testRootsForSpec(spec, filePath)) {
    for (const file of expandPath(root)) {
      if (file === filePath) continue;
      if (!TEXT_EXT.test(file)) continue;
      let content;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const next = rewriteTcIds(content, mapping);
      if (next !== content) planned.push({ path: file, text: next });
    }
  }

  // Also rewrite any in-tree review records next to the spec that cite TC-N.
  for (const p of pathList(spec.frontmatter.review)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) continue;
    const reviewPath = resolve(dirname(filePath), p);
    try {
      const content = readFileSync(reviewPath, "utf8");
      const next = rewriteTcIds(content, mapping);
      if (next !== content) planned.push({ path: reviewPath, text: next });
    } catch {
      // Missing review paths are a lint warning, not a migration hard-fail.
    }
  }

  if (!dryRun) {
    for (const { path, text } of planned) {
      writeFileSync(path, text, "utf8");
    }
  }

  return {
    filePath,
    changed: planned.length > 0,
    mapping: Object.fromEntries(
      [...mapping].filter(([from, to]) => from !== to),
    ),
    files: planned.map((p) => p.path),
  };
}
