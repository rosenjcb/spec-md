#!/usr/bin/env node
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { findSpecs } from "../lib/walk.js";
import { lintSpec } from "../lib/lint.js";
import { coverageForSpec } from "../lib/coverage.js";
import { parseSpec } from "../lib/parse.js";
import { specTemplate } from "../lib/template.js";
import { describeModel } from "../lib/model.js";
import { DEFAULTS, exploreModel, formatViolation } from "../lib/explore.js";
import { formatConformanceFailure, loadAdapter, runConformance } from "../lib/conform.js";
import { c, glyph, bar, relative } from "../lib/report.js";

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
);

// Flags that take a value, whether written as --key=val or --key val.
const VALUE_FLAGS = new Set([
  "out",
  "sources",
  "tests",
  "title",
  "depth",
  "max-states",
  "max-traces",
  "max-inits",
  "max-args",
]);

const MODEL_SUBCOMMANDS = new Set(["check", "test", "list"]);

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

/** Exploration / conformance bounds, from flags with the library defaults. */
function bounds(flags) {
  const int = (key, fallback) => {
    if (flags[key] === undefined) return fallback;
    const value = Number.parseInt(String(flags[key]), 10);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`--${key} must be a non-negative integer (got "${flags[key]}")`);
    }
    return value;
  };
  return {
    depth: int("depth", DEFAULTS.depth),
    maxStates: int("max-states", DEFAULTS.maxStates),
    maxTraces: int("max-traces", DEFAULTS.maxTraces),
    maxInits: int("max-inits", DEFAULTS.maxInits),
    maxArgs: int("max-args", DEFAULTS.maxArgs),
  };
}

/** Every spec under the roots, parsed. Structural problems are lint's job. */
function loadSpecs(positional) {
  const roots = resolveRoots(positional);
  const specs = findSpecs(roots);
  if (!specs.length) {
    console.error(`${glyph.warn} No *.spec.md files found under ${roots.map(relative).join(", ")}`);
    return null;
  }
  return specs.map((file) => parseSpec(file));
}

const modelTitle = (model) =>
  `${model.id}${model.name && model.name !== model.id ? ` ${model.name}` : ""}`;

const indent = (lines, prefix = "  ") => lines.map((line) => (line ? prefix + line : "")).join("\n");

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
    lintSpec(f, {
      requireApproved: !!flags["require-approved"],
      drift: !flags["no-drift"],
    }),
  );
  const counts = (stats) => {
    const parts = [`${stats.frs} FR`, `${stats.tcs} TC`];
    if (stats.models) {
      parts.push(`${stats.actions} AC`, `${stats.invariants} INV`, `${stats.properties} BP`);
    }
    return `(${parts.join(", ")})`;
  };
  if (flags.json) {
    console.log(JSON.stringify(results.map(({ spec, ...r }) => r), null, 2));
  } else {
    for (const r of results) {
      const rel = relative(r.filePath);
      if (r.problems.length === 0) {
        console.log(`${glyph.ok} ${c.bold(rel)} ${c.gray(counts(r.stats))}`);
        continue;
      }
      console.log(`${c.bold(rel)} ${c.gray(counts(r.stats))}`);
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
      `${coveredTc}/${totalTc} test cases have a [TC-N] test`,
  );
  if (gap > 0 && flags.strict) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// model — the executable behavioral layer (see MODELS.md)
// ---------------------------------------------------------------------------

/** `spec-md model list` — every model, action, invariant, and property. */
function cmdModelList({ positional, flags }) {
  const specs = loadSpecs(positional);
  if (!specs) return 0;
  const withModels = specs.filter((spec) => spec.models.length);
  if (flags.json) {
    console.log(
      JSON.stringify(
        withModels.map((spec) => ({
          filePath: spec.filePath,
          models: spec.models.map((model) => ({
            id: model.id,
            name: model.name,
            adapter: model.adapter,
            state: model.state.map((d) => d.src),
            derived: model.derived.map((d) => d.src),
            actions: model.actions.map((a) => ({
              id: a.id,
              name: a.name,
              requirements: a.requirements,
              requires: a.guard?.src ?? null,
              updates: a.updates.map((u) => `${u.target}' = ${u.expr.src}`),
            })),
            invariants: model.invariants.map((i) => ({
              id: i.id,
              name: i.name,
              requirements: i.requirements,
              check: i.check?.src ?? null,
            })),
            properties: model.properties.map((p) => ({
              id: p.id,
              name: p.name,
              requirements: p.requirements,
              check: p.claim?.src ?? null,
            })),
          })),
        })),
        null,
        2,
      ),
    );
    return 0;
  }

  if (!withModels.length) {
    console.log(c.gray(`No behavioral models declared in ${specs.length} spec(s).`));
    return 0;
  }
  for (const spec of withModels) {
    for (const model of spec.models) {
      console.log(`${c.bold(modelTitle(model))}  ${c.gray(relative(spec.filePath))}`);
      if (model.adapter) console.log(`  ${c.gray("adapter")}  ${model.adapter}`);
      for (const decl of model.state) console.log(`  ${c.gray("state")}    ${decl.src}`);
      for (const derived of model.derived) console.log(`  ${c.gray("derived")}  ${derived.src}`);
      const trace = (element) =>
        element.requirements.length ? c.gray(`  → ${element.requirements.join(", ")}`) : "";
      for (const action of model.actions) {
        const body = [
          action.guard ? `requires ${action.guard.src}` : null,
          ...action.updates.map((u) => `${u.target}' = ${u.expr.src}`),
        ]
          .filter(Boolean)
          .join("; ");
        const params = action.params.length
          ? `(${action.params.map((p) => p.src).join(", ")})`
          : "";
        console.log(
          `  ${c.cyan(action.id)} ${action.name}${params}${c.gray(":")} ${body}${trace(action)}`,
        );
      }
      for (const invariant of model.invariants) {
        console.log(
          `  ${c.magenta(invariant.id)} ${invariant.name}${c.gray(":")} ${invariant.check?.src ?? ""}${trace(invariant)}`,
        );
      }
      for (const property of model.properties) {
        console.log(
          `  ${c.blue(property.id)} ${property.name}${c.gray(":")} ${property.claim?.src ?? ""}${trace(property)}`,
        );
      }
      console.log();
    }
  }
  console.log(
    c.gray(
      `${withModels.reduce((n, s) => n + s.models.length, 0)} model(s) in ${withModels.length} spec(s)`,
    ),
  );
  return 0;
}

/** `spec-md model check` — explore each model; invariants and BP claims must hold. */
function cmdModelCheck({ positional, flags }) {
  const specs = loadSpecs(positional);
  if (!specs) return flags.strict ? 1 : 0;
  const opts = bounds(flags);
  const withModels = specs.filter((spec) => spec.models.length);

  if (!withModels.length) {
    console.log(
      c.gray(`No behavioral models declared in ${specs.length} spec(s) — nothing to explore.`),
    );
    return 0;
  }

  const reports = [];
  for (const spec of withModels) {
    for (const model of spec.models) {
      const report = exploreModel(model, opts);
      reports.push({ spec, model, report });
    }
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        reports.map(({ spec, model, report }) => ({
          filePath: spec.filePath,
          model: model.id,
          statesVisited: report.statesVisited,
          transitions: report.transitions,
          bounded: report.bounded,
          propertyChecks: Object.fromEntries(report.propertyChecks),
          unexercised: report.unexercised.map((p) => p.id),
          violations: report.violations.map((v) => ({
            kind: v.kind,
            element: v.element.id,
            detail: v.detail ?? v.error ?? v.message ?? null,
            initial: v.initial,
            trace: v.trace.map((s) => s.action.id),
          })),
        })),
        null,
        2,
      ),
    );
    return reports.some(({ report }) => report.violations.length) ? 1 : 0;
  }

  let violations = 0;
  let unexercised = 0;
  for (const { spec, model, report } of reports) {
    const rel = relative(spec.filePath);
    const checked = [...report.propertyChecks.values()].filter((n) => n > 0).length;
    const summary =
      `explored ${report.statesVisited} state(s), ${report.transitions} transition(s) ` +
      `to depth ${report.depth} · ${checked}/${model.properties.length} propert` +
      `${model.properties.length === 1 ? "y" : "ies"} exercised` +
      (report.outsideDomain ? ` · ${report.outsideDomain} at the domain frontier` : "");

    if (!report.violations.length) {
      console.log(`${glyph.ok} ${c.bold(modelTitle(model))} ${c.gray(rel)}`);
      console.log(`  ${c.gray(summary)} ${c.gray(`(${describeModel(model)})`)}`);
    } else {
      console.log(`${glyph.err} ${c.bold(modelTitle(model))} ${c.gray(rel)}`);
      console.log(`  ${c.gray(summary)}`);
      // The first violation is the minimal counterexample; the rest are noise.
      console.log();
      console.log(indent(formatViolation(spec, model, report.violations[0])));
      if (report.violations.length > 1) {
        console.log();
        console.log(
          c.gray(
            `  …and ${report.violations.length - 1} further violation(s): ` +
              `${[...new Set(report.violations.slice(1).map((v) => v.element.id))].join(", ")}`,
          ),
        );
      }
      console.log();
      violations += report.violations.length;
    }

    for (const property of report.unexercised) {
      unexercised++;
      console.log(
        `  ${glyph.warn} ${property.id} was never exercised within these bounds — ` +
          `raise --depth or widen a domain`,
      );
    }
    if (report.bounded) {
      console.log(
        `  ${glyph.warn} exploration stopped at --max-states ${opts.maxStates}; ` +
          `the search was not exhaustive`,
      );
    }
  }

  console.log(
    `\n${violations ? glyph.err : glyph.ok} ${reports.length} model(s), ` +
      `${c.red(violations + " violation(s)")}, ${c.yellow(unexercised + " unexercised propert" + (unexercised === 1 ? "y" : "ies"))}`,
  );
  if (violations) return 1;
  if (flags.strict && unexercised) return 1;
  return 0;
}

/** `spec-md model test` — conformance: does the implementation follow the model? */
async function cmdModelTest({ positional, flags }) {
  const specs = loadSpecs(positional);
  if (!specs) return flags.strict ? 1 : 0;
  const opts = bounds(flags);
  const targets = specs.flatMap((spec) => spec.models.map((model) => ({ spec, model })));

  if (!targets.length) {
    console.log(c.gray(`No behavioral models declared in ${specs.length} spec(s) — nothing to test.`));
    return 0;
  }

  let conformed = 0;
  let failures = 0;
  let skipped = 0;

  for (const { spec, model } of targets) {
    const rel = relative(spec.filePath);
    if (!model.adapter) {
      skipped++;
      console.log(
        `${glyph.warn} ${c.bold(modelTitle(model))} ${c.gray(rel)} — ` +
          c.gray("no `adapter` declared; run `spec-md model check` for model-only verification"),
      );
      continue;
    }
    const { adapter, error } = await loadAdapter(spec.filePath, model);
    if (!adapter) {
      failures++;
      console.log(`${glyph.err} ${c.bold(modelTitle(model))} ${c.gray(rel)} — ${c.red(error)}`);
      continue;
    }

    const report = await runConformance(model, adapter, opts);
    if (report.failure) {
      failures++;
      console.log(`${glyph.err} ${c.bold(modelTitle(model))} ${c.gray(rel)}`);
      console.log();
      console.log(indent(formatConformanceFailure({ spec, model, failure: report.failure })));
      console.log();
      continue;
    }

    conformed++;
    console.log(`${glyph.ok} ${c.bold(modelTitle(model))} ${c.gray(rel)}`);
    console.log(
      `  ${c.gray(
        `${report.tracesRun} trace(s), ${report.stepsRun} action(s), ` +
          `${report.comparisons} observation(s) conform`,
      )}`,
    );
    for (const name of report.unobserved) {
      console.log(
        `  ${glyph.warn} "${name}" is never returned by observe() — it is not being conformance-checked`,
      );
    }
  }

  console.log(
    `\n${failures ? glyph.err : glyph.ok} ${conformed} model(s) conform, ` +
      `${c.red(failures + " failure(s)")}${skipped ? c.gray(`, ${skipped} without an adapter`) : ""}`,
  );
  return failures ? 1 : 0;
}

/** `spec-md model [check|test|list]` — check is the default. */
function cmdModel(args) {
  const [maybeSub, ...rest] = args.positional;
  const sub = MODEL_SUBCOMMANDS.has(maybeSub) ? maybeSub : "check";
  const positional = MODEL_SUBCOMMANDS.has(maybeSub) ? rest : args.positional;
  const scoped = { ...args, positional };
  if (sub === "list") return cmdModelList(scoped);
  if (sub === "test") return cmdModelTest(scoped);
  return cmdModelCheck(scoped);
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
      model: !!flags.model,
    }),
  );
  console.log(`${glyph.ok} Created ${c.bold(relative(out))}`);
  console.log(c.gray(`  Fill in the sections, then: spec-md lint ${relative(out)}`));
  return 0;
}

async function cmdCheck(args) {
  // lint + coverage + model check in one pass; used by CI. Strict by default.
  const strictArgs = { ...args, flags: { strict: true, ...args.flags } };
  console.log(c.bold("→ Linting specs"));
  const lintCode = cmdLint(strictArgs);
  console.log(c.bold("\n→ Checking test coverage"));
  const covCode = cmdCoverage(strictArgs);

  let modelCode = 0;
  if (!strictArgs.flags["no-model"]) {
    console.log(c.bold("\n→ Checking behavioral models"));
    modelCode = cmdModelCheck(strictArgs);
    // Conformance runs implementation code, so it stays opt-in.
    if (strictArgs.flags.conform) {
      console.log(c.bold("\n→ Conformance testing behavioral models"));
      modelCode = (await cmdModelTest(strictArgs)) || modelCode;
    }
  }
  return lintCode || covCode || modelCode;
}

function usage() {
  console.log(`${c.bold("spec-md")} ${c.gray("v" + pkg.version)} — tooling for *.spec.md documents

${c.bold("Usage")}
  spec-md <command> [paths...] [options]

${c.bold("Commands")}
  ${c.cyan("lint")} [paths]        Validate frontmatter, FR/TC/model structure, and links
  ${c.cyan("coverage")} [paths]    Report which TC-N have a matching [TC-N] test
  ${c.cyan("check")} [paths]       lint + coverage + model check, strict (ideal for CI)
  ${c.cyan("model")} [sub] [paths] Behavioral models: ${c.cyan("check")} (default), ${c.cyan("test")}, ${c.cyan("list")}
  ${c.cyan("list")} [paths]        List every spec with FR/TC counts and coverage
  ${c.cyan("new")} <domain>        Scaffold a new <domain>.spec.md from a template
  ${c.cyan("create")} <domain>     Alias for new

${c.bold("Options")}
  --strict            Exit non-zero on warnings / coverage gaps
  --require-approved  lint/check: fail unless every review record linked from
                      a spec's \`review\` key has status "approved" (merge gate)
  --json              Machine-readable output
  --tests <path>      coverage: search this path for [TC-N] tags
  --no-drift          lint/check: skip the requirement/model drift heuristics
  --no-model          check: skip the behavioral model step
  --conform           check: also run \`model test\` (executes the adapter)
  --depth <n>         model: action sequence depth to explore (default ${DEFAULTS.depth})
  --max-states <n>    model check: state budget (default ${DEFAULTS.maxStates})
  --max-traces <n>    model test: trace budget (default ${DEFAULTS.maxTraces})
  --max-inits <n>     model: generated initial states (default ${DEFAULTS.maxInits})
  --max-args <n>      model: values tried per action parameter (default ${DEFAULTS.maxArgs})
  --model             new: include a Behavioral Model section
  --out <path>        new: output file path
  --sources <paths>   new: frontmatter sources
  --tests <paths>     new: frontmatter tests
  --title <text>      new: frontmatter title
  --force             new: overwrite an existing file
  -h, --help          Show this help
  -v, --version       Show version

${c.bold("Examples")}
  spec-md lint                    ${c.gray("# lint every spec in the repo")}
  spec-md coverage src/orders     ${c.gray("# coverage for specs under a dir")}
  spec-md check --strict          ${c.gray("# CI gate")}
  spec-md check --require-approved ${c.gray("# merge gate: linked reviews must be approved")}
  spec-md model check             ${c.gray("# explore every model: invariants + BP claims")}
  spec-md model test --depth 4    ${c.gray("# conformance: implementation vs. model")}
  spec-md new billing --model     ${c.gray("# scaffold billing.spec.md with a model")}
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
  model: cmdModel,
  models: cmdModel,
  list: cmdList,
  ls: cmdList,
  new: cmdNew,
  create: cmdNew,
  init: cmdNew,
};

const handler = commands[command];
if (!handler) {
  console.error(`${glyph.err} Unknown command: ${command}\n`);
  usage();
  process.exit(2);
}

try {
  // `model test` and `check --conform` import an adapter, so a handler may be async.
  process.exit((await handler(args)) || 0);
} catch (e) {
  console.error(`${glyph.err} ${e.message}`);
  process.exit(2);
}
