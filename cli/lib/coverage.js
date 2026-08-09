import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseSpec, pathList, extractTcTags } from "./parse.js";
import { expandPath } from "./walk.js";

const TEXT_EXT = /\.(m?[jt]sx?|py|rb|go|rs|java|kt|cs|php|swift|scala|clj|ex|exs|http|feature|md|txt|sh|c|cc|cpp|h|hpp|sql|yaml|yml)$/i;

/**
 * Compute TC coverage for one spec.
 *
 * A TC id is "covered" when a `[TC-XXXX]` tag appears anywhere in the spec's
 * `tests` paths (or, if none are declared, anywhere under `fallbackRoots`).
 * Ids are opaque strings — never parsed as numbers.
 */
export function coverageForSpec(filePath, { fallbackRoots = [], searchRoots = null } = {}) {
  const spec = parseSpec(filePath);
  const dir = dirname(filePath);

  let roots;
  if (searchRoots) {
    roots = searchRoots;
  } else {
    const declared = pathList(spec.frontmatter.tests).map((p) => resolve(dir, p));
    roots = declared.length ? declared : fallbackRoots.length ? fallbackRoots : [dir];
  }

  const foundTags = new Set();
  const tagLocations = new Map(); // tag -> [files]
  for (const root of roots) {
    for (const file of expandPath(root)) {
      if (file === filePath) continue; // don't count the spec's own table
      if (!TEXT_EXT.test(file)) continue;
      let content;
      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const tag of extractTcTags(content)) {
        foundTags.add(tag);
        if (!tagLocations.has(tag)) tagLocations.set(tag, []);
        tagLocations.get(tag).push(file);
      }
    }
  }

  const active = spec.tcs.filter((tc) => !tc.removed && tc.valid);
  const covered = active.filter((tc) => foundTags.has(tc.id));
  const uncovered = active.filter((tc) => !foundTags.has(tc.id));
  // Tags in tests that point at a TC the spec never declares.
  const declaredIds = new Set(spec.tcs.map((tc) => tc.id));
  const orphanTags = [...foundTags].filter((t) => !declaredIds.has(t)).sort();

  const pct = active.length === 0 ? 100 : Math.round((covered.length / active.length) * 100);

  return {
    filePath,
    total: active.length,
    covered: covered.map((tc) => tc.id),
    uncovered: uncovered.map((tc) => tc.id),
    orphanTags,
    tagLocations,
    pct,
    roots,
  };
}
