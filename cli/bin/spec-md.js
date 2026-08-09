#!/usr/bin/env node
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { findSpecs } from "../lib/walk.js";
import { lintSpec } from "../lib/lint.js";
import { coverageForSpec } from "../lib/coverage.js";
import { specTemplate } from "../lib/template.js";
import {
  generateTcId,
  migrateSpecIds,
  tcIdentitySeed,
} from "../lib/ids.js";
import { c, glyph, bar, relative } from "../lib/report.js";

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
);

// Flags that take a value, whether written as --key=val or --key val.
const VALUE_FLAGS = new Set(["out", "sources", "tests", "title", "requirement", "scenario", "used"]);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function resolveRoots(positional) {
  const roots = positional.length ? positional : ["."];
  return roots.map((r) => resolve(process.cwd(), r));
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function cmdLint({ positional, flags }) {
  const roots = resolveRoots(positional);
  const specs = findSpecs(roots);
  if (!specs.length) {
    console.error(`${glyph.warn} No *.spec.md files found under ${roots.map(relative).join(", ")}`);
    return flags.strict ? 1 : 0;
  }

  const results = specs.map((f) =>
    lintSpec(f, { requireApproved: !!flags["require-approved"] }),
  );
  if (flags.json) {
    console.log(JSON.stringify(results.map(({ spec, ...r }) => r), null, 2));
  } else {
    for (const r of results) {
      const rel = relative(r.filePath);
      if (r.problems.length === 0) {
        console.log(`${glyph.ok} ${c.bold(rel)} ${c.gray(`(${r.stats.frs} FR, ${r.stats.tcs} TC)`)}`);
        continue;
      }
      console.log(`${c.bold(rel)} ${c.gray(`(${r.stats.frs} FR, ${r.stats.tcs} TC)`)}`);
      for (const p of r.problems) {
        const g = p.level === "error" ? glyph.err : glyph.warn;
        const loc = p.line ? c.gray(`:${p.line}`) : "";
        console.log(`  ${g} ${p.msg}${loc}`);
      }
    }
  }

  const errors = results.reduce((n, r) => n + r.stats.errors, 0);
  const warnings = results.reduce((n, r) => n + r.stats.warnings, 0);
  console.log(
    `\n${errors ? glyph.err : glyph.ok} ${specs.length} spec(s), ` +
      `${c.red(errors + " error(s)")}, ${c.yellow(warnings + " warning(s)")}`,
  );
  if (errors > 0) return 1;
  if (warnings > 0 && flags.strict) return 1;
  return 0;
}

function cmdCoverage({ positional, flags }) {
  const roots = resolveRoots(positional);
  const specs = findSpecs(roots);
  if (!specs.length) {
    console.error(`${glyph.warn} No *.spec.md files found`);
    return flags.strict ? 1 : 0;
  }
  // When only a single dir is given, let un-declared tests fall back to it.
  const fallbackRoots = roots;
  const searchRoots = flags.tests ? [resolve(process.cwd(), flags.tests)] : null;

  const results = specs.map((f) =>
    coverageForSpec(f, { fallbackRoots, searchRoots }),
  );
  if (flags.json) {
    console.log(
      JSON.stringify(
        results.map((r) => ({ ...r, tagLocations: undefined })),
        null,
        2,
      ),
    );
  } else {
    for (const r of results) {
      console.log(
        `${bar(r.pct)} ${c.bold(`${r.pct}%`)} ${relative(r.filePath)} ` +
          c.gray(`(${r.covered.length}/${r.total})`),
      );
      if (r.uncovered.length) {
        console.log(`  ${glyph.err} uncovered: ${c.red(r.uncovered.join(", "))}`);
      }
      if (r.orphanTags.length) {
        console.log(
          `  ${glyph.warn} tagged but not in spec: ${c.yellow(r.orphanTags.join(", "))}`,
        );
      }
    }
  }

  const totalTc = results.reduce((n, r) => n + r.total, 0);
  const coveredTc = results.reduce((n, r) => n + r.covered.length, 0);
  const gap = totalTc - coveredTc;
  const pct = totalTc === 0 ? 100 : Math.round((coveredTc / totalTc) * 100);
  console.log(
    `\n${gap === 0 ? glyph.ok : glyph.warn} Overall ${c.bold(pct + "%")} — ` +
      `${coveredTc}/${totalTc} test cases have a [TC-XXXX] test`,
  );
  if (gap > 0 && flags.strict) return 1;
  return 0;
}

function cmdList({ positional, flags }) {
  const roots = resolveRoots(positional);
  const specs = findSpecs(roots);
  if (!specs.length) {
    console.error(`${glyph.warn} No *.spec.md files found`);
    return 0;
  }
  const rows = specs.map((f) => {
    const { spec } = lintSpec(f);
    const cov = coverageForSpec(f, { fallbackRoots: roots });
    return {
      file: relative(f),
      title: spec.frontmatter.title || basename(f),
      frs: spec.frs.length,
      tcs: spec.tcs.length,
      pct: cov.pct,
    };
  });
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  for (const r of rows) {
    console.log(
      `${c.bold(r.title)}  ${c.gray(r.file)}\n` +
        `  ${r.frs} FR · ${r.tcs} TC · ${bar(r.pct, 12)} ${r.pct}%`,
    );
  }
  console.log(c.gray(`\n${rows.length} spec(s)`));
  return 0;
}

function cmdNew({ positional, flags }) {
  const domain = positional[0];
  if (!domain) {
    console.error(`${glyph.err} usage: spec-md new <domain> [--out <path>] [--sources ...] [--tests ...]`);
    return 1;
  }
  const clean = domain.replace(/\.spec\.md$/, "").toLowerCase();
  const out = flags.out
    ? resolve(process.cwd(), String(flags.out))
    : resolve(process.cwd(), `${clean}.spec.md`);
  if (existsSync(out) && !flags.force) {
    console.error(`${glyph.err} ${relative(out)} already exists (use --force to overwrite)`);
    return 1;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    specTemplate({
      domain: clean,
      title: flags.title,
      sources: flags.sources,
      tests: flags.tests,
    }),
  );
  console.log(`${glyph.ok} Created ${c.bold(relative(out))}`);
  console.log(c.gray(`  Fill in the sections, then: spec-md lint ${relative(out)}`));
  return 0;
}

function cmdCheck(args) {
  // lint + coverage in one pass; used by CI. Strict by default.
  const strictArgs = { ...args, flags: { strict: true, ...args.flags } };
  console.log(c.bold("→ Linting specs"));
  const lintCode = cmdLint(strictArgs);
  console.log(c.bold("\n→ Checking test coverage"));
  const covCode = cmdCoverage(strictArgs);
  return lintCode || covCode;
}

/**
 * Migrate sequential TC-N ids to stable TC-XXXX ids.
 * Plans every rewrite first; aborts a file that would collide.
 * Idempotent on already-migrated specs.
 */
function cmdMigrateIds({ positional, flags }) {
  const roots = resolveRoots(positional);
  const specs = findSpecs(roots);
  if (!specs.length) {
    console.error(`${glyph.warn} No *.spec.md files found under ${roots.map(relative).join(", ")}`);
    return flags.strict ? 1 : 0;
  }

  const results = [];
  for (const file of specs) {
    try {
      results.push(migrateSpecIds(file, { dryRun: !!flags["dry-run"] }));
    } catch (e) {
      console.error(`${glyph.err} ${relative(file)}: ${e.message}`);
      return 1;
    }
  }

  if (flags.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    let changedCount = 0;
    for (const r of results) {
      if (!r.changed) {
        console.log(`${glyph.ok} ${relative(r.filePath)} ${c.gray("(already stable)")}`);
        continue;
      }
      changedCount++;
      const pairs = Object.entries(r.mapping)
        .map(([from, to]) => `${from}→${to}`)
        .join(", ");
      const verb = flags["dry-run"] ? "would rewrite" : "rewrote";
      console.log(
        `${glyph.ok} ${c.bold(relative(r.filePath))} ${c.gray(`(${pairs})`)}`,
      );
      for (const f of r.files) {
        console.log(`  ${c.gray(verb)} ${relative(f)}`);
      }
    }
    console.log(
      `\n${glyph.ok} ${specs.length} spec(s), ${changedCount} migrated` +
        (flags["dry-run"] ? c.gray(" (dry run)") : ""),
    );
  }
  return 0;
}

/**
 * Allocate a new stable TC id from a requirement + scenario seed.
 * Usage: spec-md id --requirement FR-4 --scenario "no customerId"
 *    or: spec-md id FR-4 "no customerId"
 */
function cmdId({ positional, flags }) {
  let requirement = flags.requirement ? String(flags.requirement) : "";
  let scenario = flags.scenario ? String(flags.scenario) : "";
  if (!requirement && positional.length) {
    requirement = positional[0];
    scenario = positional.slice(1).join(" ");
  }
  if (!requirement) {
    console.error(
      `${glyph.err} usage: spec-md id --requirement FR-4 --scenario "…" [--used TC-XXXX,…]`,
    );
    return 1;
  }
  const used = flags.used
    ? String(flags.used)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const id = generateTcId(tcIdentitySeed(requirement, scenario), used);
  console.log(id);
  return 0;
}

function usage() {
  console.log(`${c.bold("spec-md")} ${c.gray("v" + pkg.version)} — tooling for *.spec.md documents

${c.bold("Usage")}
  spec-md <command> [paths...] [options]

${c.bold("Commands")}
  ${c.cyan("lint")} [paths]        Validate frontmatter, FR/TC structure, and links
  ${c.cyan("coverage")} [paths]    Report which TC ids have a matching [TC-XXXX] test
  ${c.cyan("check")} [paths]       lint + coverage, strict (ideal for CI)
  ${c.cyan("list")} [paths]        List every spec with FR/TC counts and coverage
  ${c.cyan("new")} <domain>        Scaffold a new <domain>.spec.md from a template
  ${c.cyan("create")} <domain>     Alias for new
  ${c.cyan("id")}                  Generate a stable TC-XXXX from requirement + scenario
  ${c.cyan("migrate-ids")} [paths] Rewrite legacy TC-N rows and [TC-N] tags to TC-XXXX

${c.bold("Options")}
  --strict            Exit non-zero on warnings / coverage gaps
  --require-approved  lint/check: fail unless every review record linked from
                      a spec's \`review\` key has status "approved" (merge gate)
  --json              Machine-readable output
  --tests <path>      coverage: search this path for [TC-XXXX] tags
  --out <path>        new: output file path
  --sources <paths>   new: frontmatter sources
  --tests <paths>     new: frontmatter tests
  --title <text>      new: frontmatter title
  --force             new: overwrite an existing file
  --requirement FR-N  id: Functional Requirement the case proves
  --scenario <text>   id: scenario text used only as the generation seed
  --used <ids>        id: comma-separated TC ids already taken in the spec
  --dry-run           migrate-ids: plan rewrites without writing files
  -h, --help          Show this help
  -v, --version       Show version

${c.bold("Examples")}
  spec-md lint                    ${c.gray("# lint every spec in the repo")}
  spec-md coverage src/orders     ${c.gray("# coverage for specs under a dir")}
  spec-md check --strict          ${c.gray("# CI gate")}
  spec-md check --require-approved ${c.gray("# merge gate: linked reviews must be approved")}
  spec-md new billing             ${c.gray("# scaffold billing.spec.md")}
  spec-md id --requirement FR-4 --scenario "no customerId"
  spec-md migrate-ids .           ${c.gray("# TC-1 → TC-XXXX across specs + tests")}
`);
}

// ---------------------------------------------------------------------------

const raw = process.argv.slice(2);
if (raw.includes("-h") || raw.includes("--help") || raw.length === 0) {
  usage();
  process.exit(0);
}
if (raw.includes("-v") || raw.includes("--version")) {
  console.log(pkg.version);
  process.exit(0);
}

const [command, ...rest] = raw;
const args = parseArgs(rest);

const commands = {
  lint: cmdLint,
  coverage: cmdCoverage,
  cov: cmdCoverage,
  check: cmdCheck,
  list: cmdList,
  ls: cmdList,
  new: cmdNew,
  create: cmdNew,
  init: cmdNew,
  id: cmdId,
  "gen-id": cmdId,
  "migrate-ids": cmdMigrateIds,
  migrate: cmdMigrateIds,
};

const handler = commands[command];
if (!handler) {
  console.error(`${glyph.err} Unknown command: ${command}\n`);
  usage();
  process.exit(2);
}

try {
  process.exit(handler(args) || 0);
} catch (e) {
  console.error(`${glyph.err} ${e.message}`);
  process.exit(2);
}
