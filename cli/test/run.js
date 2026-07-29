#!/usr/bin/env node
// Zero-dependency test runner for the spec-md CLI and libraries.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import {
  parseFrontmatter,
  pathList,
  parseTables,
  parseSpec,
  extractTcTags,
} from "../lib/parse.js";
import { bar, relative } from "../lib/report.js";
import { findSpecs, walkFiles } from "../lib/walk.js";
import { specTemplate } from "../lib/template.js";
import { compileExpr, evalExpr, freeVars, ExprError } from "../lib/expr.js";
import { parseModels, validateModels } from "../lib/model.js";
import { applyAction, exploreModel, initialStates } from "../lib/explore.js";
import { loadAdapter, runConformance } from "../lib/conform.js";
import { driftWarnings } from "../lib/drift.js";
import { lintSpec } from "../lib/lint.js";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, "../bin/spec-md.js");
const exampleSpec = resolve(here, "../../examples/pizza-ts");


let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}`);
  }
}

/** Run the CLI, returning { code, out }. Never throws on non-zero exit. */
function run(args, opts = {}) {
  try {
    const out = execFileSync("node", [bin, ...args], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      ...opts,
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

// Conformance imports an adapter, so a few checks have to await.
const asyncTests = [];
const atest = (name, fn) => asyncTests.push([name, fn]);

async function runAsyncTests() {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      passed++;
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (e) {
      failed++;
      console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${e.message}`);
    }
  }
}

/** A temp dir that is always cleaned up. */
function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-model-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withTempSpec(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-test-"));
  try {
    const file = join(dir, "thing.spec.md");
    writeFileSync(file, contents);
    fn(dir, file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("spec-md CLI tests\n");

test("lint passes on the pizza-ts example", () => {
  const { code, out } = run(["lint", exampleSpec]);
  assert.equal(code, 0, out);
  assert.match(out, /0 error/);
});

test("coverage reports 100% on the example", () => {
  const { code, out } = run(["coverage", exampleSpec]);
  assert.equal(code, 0, out);
  assert.match(out, /100%/);
});

test("lint flags a spec missing `type`", () => {
  withTempSpec(
    `---\ntitle: No type\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /missing required key `type`/);
    },
  );
});

test("lint flags duplicate FR ids and dangling FR references", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Dup\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n| FR-1 | b |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-9 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /Duplicate requirement id FR-1/);
      assert.match(out, /references FR-9/);
    },
  );
});

test("lint flags skipped and out-of-order FR/TC ids", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Jumbled\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n| FR-3 | b |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n| TC-2 | FR-1 | x | y |\n| TC-84 | FR-3 | x | y |\n| TC-3 | FR-3 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /expected FR-2 in this row, found FR-3/);
      assert.match(out, /expected TC-3 in this row, found TC-84/);
      assert.match(out, /expected TC-4 in this row, found TC-3/);
    },
  );
});

test("coverage --strict exits non-zero when a TC has no test", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Uncovered\n---\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (dir) => {
      const { code, out } = run(["coverage", "--strict", dir]);
      assert.equal(code, 1, out);
      assert.match(out, /uncovered/);
    },
  );
});

test("lint --require-approved fails when the linked review is still open", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Draft thing\nreview: ./thing.review.md\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (dir, file) => {
      writeFileSync(
        join(dir, "thing.review.md"),
        `---\ntype: Review\ntitle: "Review: Thing"\nspec: ./thing.spec.md\nstatus: open\n---\n`,
      );
      const { code, out } = run(["lint", "--require-approved", file]);
      assert.equal(code, 1, out);
      assert.match(out, /must be "approved"/);
      // Without the flag the same spec passes.
      const plain = run(["lint", file]);
      assert.equal(plain.code, 0, plain.out);
    },
  );
});

test("lint --require-approved fails when the linked review is missing", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Dangling\nreview: ./gone.review.md\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", "--require-approved", file]);
      assert.equal(code, 1, out);
      assert.match(out, /missing record/);
    },
  );
});

test("lint --require-approved passes approved, notice, and review-less specs", () => {
  // No review key at all — not gated.
  withTempSpec(
    `---\ntype: Spec\ntitle: No review\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", "--require-approved", file]);
      assert.equal(code, 0, out);
    },
  );
  // A notice: linked review with no status — not gated.
  withTempSpec(
    `---\ntype: Spec\ntitle: Noticed\nreview: ./thing.review.md\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (dir, file) => {
      writeFileSync(
        join(dir, "thing.review.md"),
        `---\ntype: Review\ntitle: "Review: Thing"\nspec: ./thing.spec.md\nmode: notice\n---\n`,
      );
      const { code, out } = run(["lint", "--require-approved", file]);
      assert.equal(code, 0, out);
    },
  );
  // The pizza-ts example links an approved review.
  const { code, out } = run(["lint", "--require-approved", exampleSpec]);
  assert.equal(code, 0, out);
});

test("lint warns when a relative `review` path is missing, allows URLs", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Review paths\nreview: ./nope.review.md\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 0, out); // warning, not error
      assert.match(out, /`review` path does not exist/);
      const strict = run(["lint", "--strict", file]);
      assert.equal(strict.code, 1, strict.out);
    },
  );
  withTempSpec(
    `---\ntype: Spec\ntitle: Review URL\nreview: https://notion.example.com/page\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", "--strict", file]);
      assert.equal(code, 0, out);
    },
  );
});

test("lint validates `resource` URLs on specs and linked reviews", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Resource fields\nresource: https://publish.example.com/spec\nreview: ./thing.review.md\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (dir, file) => {
      writeFileSync(
        join(dir, "thing.review.md"),
        `---\ntype: Review\ntitle: "Review: Thing"\nspec: ./thing.spec.md\nresource: https://publish.example.com/review\nstatus: approved\n---\n`,
      );
      const ok = run(["lint", "--strict", "--require-approved", file]);
      assert.equal(ok.code, 0, ok.out);
    },
  );
  withTempSpec(
    `---\ntype: Spec\ntitle: Bad review resource\nreview: ./thing.review.md\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (dir, file) => {
      writeFileSync(
        join(dir, "thing.review.md"),
        `---\ntype: Review\ntitle: "Review: Thing"\nspec: ./thing.spec.md\nresource: not-a-url\nstatus: approved\n---\n`,
      );
      const bad = run(["lint", "--strict", "--require-approved", file]);
      assert.equal(bad.code, 1, bad.out);
      assert.match(bad.out, /`resource` in review record .* is not a valid URL/);
    },
  );
});

test("new scaffolds a spec that lints clean of errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-new-"));
  try {
    const out = join(dir, "widget.spec.md");
    const r1 = run(["new", "widget", "--out", out]);
    assert.equal(r1.code, 0, r1.out);
    assert.ok(existsSync(out));
    const r2 = run(["lint", out]);
    assert.equal(r2.code, 0, r2.out); // warnings ok, no errors
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("create is an alias for new", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-create-"));
  try {
    const out = join(dir, "gadget.spec.md");
    const r = run(["create", "gadget", "--out", out]);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help and version work", () => {
  assert.equal(run(["--version"]).code, 0);
  assert.match(run(["--help"]).out, /Usage/);
});

console.log("\nparse");
test("parseFrontmatter reads scalars and inline arrays", () => {
  const { data, hasFrontmatter } = parseFrontmatter(
    "---\ntype: Spec\ntags: [a, b]\ntitle: Demo\n---\n\nBody\n",
  );
  assert.equal(hasFrontmatter, true);
  assert.equal(data.type, "Spec");
  assert.deepEqual(data.tags, ["a", "b"]);
  assert.equal(data.title, "Demo");
});

test("pathList normalizes scalars and arrays", () => {
  assert.deepEqual(pathList(" ./src/orders "), ["./src/orders"]);
  assert.deepEqual(pathList(["x", "y"]), ["x", "y"]);
  assert.deepEqual(pathList(""), []);
});

test("parseTables extracts FR and TC rows", () => {
  const text = `### Functional Requirements
| ID | Requirement |
|----|-------------|
| FR-1 | create |

### QA Test Cases
| Test ID | Requirement | Scenario | Expected Outcome |
|---------|-------------|----------|------------------|
| TC-1 | FR-1 | input | output |
`;
  const { frs, tcs, sawFrTable, sawTcTable } = parseTables(text);
  assert.equal(sawFrTable, true);
  assert.equal(sawTcTable, true);
  assert.equal(frs[0].id, "FR-1");
  assert.equal(tcs[0].id, "TC-1");
  assert.deepEqual(tcs[0].requirements, ["FR-1"]);
});

test("extractTcTags collects unique TC references", () => {
  const tags = extractTcTags('it("[TC-1] one", () => {}); it("[TC-1] dup", () => {}); [TC-2]');
  assert.deepEqual([...tags].sort(), ["TC-1", "TC-2"]);
});

console.log("\nreport");
test("bar renders filled blocks without color when NO_COLOR is set", () => {
  const old = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    assert.match(bar(50, 4), /██/);
    assert.match(bar(50, 4), /░░/);
  } finally {
    if (old === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = old;
  }
});

test("relative shortens paths under cwd", () => {
  const cwd = resolve("/tmp/project");
  assert.equal(relative(join(cwd, "specs/a.spec.md"), cwd), "specs/a.spec.md");
});

console.log("\nwalk");
test("findSpecs discovers nested spec files and ignores node_modules", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-walk-"));
  try {
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/nested.spec.md"), "---\ntype: Spec\ntitle: x\n---\n");
    writeFileSync(join(dir, "node_modules/hidden.spec.md"), "---\ntype: Spec\ntitle: y\n---\n");
    const found = findSpecs([dir]);
    assert.equal(found.length, 1);
    assert.ok(found[0].endsWith("nested.spec.md"));
    const walked = [...walkFiles(join(dir, "src"))];
    assert.equal(walked.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log("\ntemplate");
test("specTemplate scaffolds domain paths and FR/TC tables", () => {
  const body = specTemplate({ domain: "billing" });
  assert.match(body, /title: "Spec: Billing"/);
  assert.match(body, /sources: \[\.\/src\/billing\]/);
  assert.match(body, /FR-1/);
  assert.match(body, /TC-1/);
});

test("specTemplate renders multi-path flag values as YAML arrays", () => {
  const body = specTemplate({ domain: "billing", sources: "./src/billing, ./src/app.ts" });
  assert.match(body, /sources: \[\.\/src\/billing, \.\/src\/app\.ts\]/);
  assert.match(body, /tests: \[\.\/test\/billing\]/);
});

console.log("\nexpr");
const evaluate = (src, vars = {}, pre = null) => evalExpr(compileExpr(src).ast, { vars, pre });

test("evaluates arithmetic, comparisons, and logic", () => {
  assert.equal(evaluate("1 + 2 * 3"), 7);
  assert.equal(evaluate("(1 + 2) * 3"), 9);
  assert.equal(evaluate("count + 1", { count: 41 }), 42);
  assert.equal(evaluate("count >= 0 and count < 10", { count: 5 }), true);
  assert.equal(evaluate("not (a = b)", { a: 1, b: 2 }), true);
  assert.equal(evaluate("status = created", { status: "created", created: "created" }), true);
  assert.equal(evaluate("max(3, min(9, 7)) - abs(-1)"), 6);
  assert.equal(evaluate("round(1050 * 1.3)"), 1365);
});

test("implies is vacuously true and short-circuits", () => {
  assert.equal(evaluate("false implies false"), true);
  assert.equal(evaluate("true implies false"), false);
  // The right side is never evaluated, so an unknown name cannot throw.
  assert.equal(evaluate("false implies missing = 1"), true);
});

test("`@pre` reads the pre-state and is rejected without one", () => {
  assert.equal(evaluate("count = count@pre + 1", { count: 2 }, { count: 1 }), true);
  assert.throws(() => evaluate("count@pre", { count: 1 }), /only valid in a property claim/);
});

test("rejects type confusion and unknown names rather than coercing", () => {
  assert.throws(() => evaluate("1 + true"), ExprError);
  assert.throws(() => evaluate('1 < "a"'), /Cannot compare/);
  assert.throws(() => evaluate("nope + 1"), /Unknown variable "nope"/);
  assert.throws(() => evaluate("wat(1)"), /Unknown function "wat"/);
  assert.throws(() => evaluate("1 / 0"), /Division by zero/);
});

test("freeVars separates current and pre reads", () => {
  const { vars, pre } = freeVars(compileExpr("total = total@pre + unitPrice * qty").ast);
  assert.deepEqual([...vars].sort(), ["qty", "total", "unitPrice"]);
  assert.deepEqual([...pre], ["total"]);
});

console.log("\nmodel");
const MODEL_DOC = `---
type: Spec
title: "Spec: Counter"
---

### Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Incrementing increases the counter by one |
| FR-2 | Decrementing decreases the counter by one, and never below zero |
| FR-3 | Setting the counter replaces its value |

### QA Test Cases

| Test ID | Requirement | Scenario | Expected Outcome |
|---------|-------------|----------|------------------|
| TC-1 | FR-1 | Increment from 0 | 1 |
| TC-2 | FR-2 | Decrement at 0 | stays 0 |
| TC-3 | FR-3, AC-3 | Set to 42 | 42 |

### Behavioral Model

\`\`\`spec-model
model: MOD-1 Counter
adapter: ./counter.adapter.mjs

state:
  count: integer in 0..100 = 0
  status: string in [idle, busy] = idle

derived:
  display: count

AC-1 Increment:
  requirement: FR-1
  count' = count + 1

AC-2 Decrement:
  requirement: FR-2
  requires: count > 0
  count' = count - 1

AC-3 Set(value: integer in 0..100):
  requirement: FR-3
  requires: status = idle
  count' = value

INV-1 Never negative:
  requirement: FR-2
  check: count >= 0

BP-1 Increment steps by one:
  requirement: FR-1
  check: after AC-1, count = count@pre + 1

BP-2 Increment and Decrement are inverses:
  requirement: FR-1, FR-2
  check: AC-1 then AC-2 preserves count
\`\`\`
`;

const parseModelDoc = (doc = MODEL_DOC) => {
  const { models, problems } = parseModels(doc, 0);
  return { model: models[0], models, problems };
};

test("parseModels reads state, derived, actions, invariants, and properties", () => {
  const { model, problems } = parseModelDoc();
  assert.deepEqual(problems, []);
  assert.equal(model.id, "MOD-1");
  assert.equal(model.name, "Counter");
  assert.equal(model.adapter, "./counter.adapter.mjs");
  assert.deepEqual(
    model.state.map((s) => [s.name, s.type, s.initial]),
    [
      ["count", "integer", 0],
      ["status", "string", "idle"],
    ],
  );
  assert.deepEqual(model.state[0].domain, { kind: "range", min: 0, max: 100 });
  assert.deepEqual(model.state[1].domain, { kind: "enum", values: ["idle", "busy"] });
  assert.deepEqual(model.derived.map((d) => d.name), ["display"]);
  assert.deepEqual(model.actions.map((a) => a.id), ["AC-1", "AC-2", "AC-3"]);
  assert.equal(model.actions[1].guard.src, "count > 0");
  assert.deepEqual(model.actions[2].params.map((p) => p.name), ["value"]);
  assert.deepEqual(model.actions[2].requirements, ["FR-3"]);
  assert.deepEqual(model.properties.map((p) => p.claim.kind), ["after", "preserves"]);
  assert.deepEqual(model.properties[1].claim.actions, ["AC-1", "AC-2"]);
  // String enum values become symbols usable bare in expressions.
  assert.deepEqual(model.constants, { idle: "idle", busy: "busy" });
});

test("validateModels accepts the counter and reports unknown names", () => {
  const frIds = new Set(["FR-1", "FR-2", "FR-3"]);
  const { models } = parseModelDoc();
  assert.deepEqual(validateModels(models, { frIds }), []);

  const broken = parseModelDoc(
    MODEL_DOC.replace("count' = count + 1", "count' = tally + 1")
      .replace("check: count >= 0", "check: count >= zero")
      .replace("check: AC-1 then AC-2 preserves count", "check: AC-1 then AC-9 preserves count"),
  );
  const messages = validateModels(broken.models, { frIds }).map((p) => p.msg);
  assert.ok(messages.some((m) => /Unknown variable "tally" in update in AC-1/.test(m)), messages);
  assert.ok(messages.some((m) => /Unknown variable "zero" in INV-1/.test(m)), messages);
  assert.ok(messages.some((m) => /BP-2 references AC-9/.test(m)), messages);
});

test("validateModels rejects actions with no update and dangling FR citations", () => {
  const doc = MODEL_DOC.replace("  count' = count + 1\n", "").replace(
    "AC-3 Set(value: integer in 0..100):\n  requirement: FR-3",
    "AC-3 Set(value: integer in 0..100):\n  requirement: FR-9",
  );
  const { models } = parseModelDoc(doc);
  const messages = validateModels(models, { frIds: new Set(["FR-1", "FR-2", "FR-3"]) }).map((p) => p.msg);
  assert.ok(messages.some((m) => /AC-1 has no state update/.test(m)), messages);
  assert.ok(messages.some((m) => /AC-3 cites FR-9/.test(m)), messages);
});

test("parseModels reports unusable declarations instead of guessing", () => {
  const { problems } = parseModelDoc(
    MODEL_DOC.replace("  count: integer in 0..100 = 0", "  count: intger in 0..100 = 0")
      .replace("  count' = count - 1", "  count' = count -")
      .replace("check: after AC-1, count = count@pre + 1", "check: whenever AC-1 happens"),
  );
  const messages = problems.map((p) => p.msg);
  assert.ok(messages.some((m) => /Unknown type "intger"/.test(m)), messages);
  assert.ok(messages.some((m) => /Unexpected "end of expression" in "count -"/.test(m)), messages);
  assert.ok(messages.some((m) => /Cannot read the property claim/.test(m)), messages);
});

test("a default outside its declared domain is an error", () => {
  const { problems } = parseModelDoc(
    MODEL_DOC.replace("count: integer in 0..100 = 0", "count: integer in 0..100 = 500"),
  );
  assert.ok(
    problems.some((p) => /outside its declared domain/.test(p.msg)),
    JSON.stringify(problems),
  );
});

console.log("\nexplore");
test("initialStates puts the declared state first, then domain boundaries", () => {
  const { model } = parseModelDoc();
  const inits = initialStates(model, { maxInits: 8 });
  assert.deepEqual(inits[0], { count: 0, status: "idle" });
  assert.ok(inits.some((s) => s.count === 100), "explores the domain maximum");
  assert.ok(inits.some((s) => s.status === "busy"), "explores each enum value");
});

test("applyAction evaluates every update against the pre-state", () => {
  const { models } = parseModels(
    `\`\`\`spec-model
model: MOD-1 Swap

state:
  a: integer in 0..3 = 1
  b: integer in 0..3 = 2

AC-1 Swap:
  a' = b
  b' = a
\`\`\`
`,
    0,
  );
  const model = models[0];
  assert.deepEqual(applyAction(model, model.actions[0], { a: 1, b: 2 }), { a: 2, b: 1 });
});

test("exploreModel finds no violation in the counter and exercises every property", () => {
  const { model } = parseModelDoc();
  const report = exploreModel(model, { depth: 3 });
  assert.deepEqual(report.violations, []);
  assert.deepEqual(report.unexercised, []);
  assert.ok(report.transitions > 0);
  assert.ok(report.propertyChecks.get("BP-1") > 0);
  assert.ok(report.propertyChecks.get("BP-2") > 0);
});

test("exploreModel reports the minimal counterexample when a property breaks", () => {
  // Clamping increment at 100 contradicts BP-1 — but only at the boundary.
  const { model } = parseModelDoc(MODEL_DOC.replace("count' = count + 1", "count' = min(count + 1, 100)"));
  const report = exploreModel(model, { depth: 3 });
  const first = report.violations[0];
  assert.ok(first, "a violation is reported");
  assert.equal(first.initial.count, 100, "the shortest counterexample starts at the boundary");
  assert.equal(first.trace.length, 1, "…and needs a single action");
  assert.ok(["BP-1", "BP-2"].includes(first.element.id), first.element.id);
});

test("exploreModel checks states past a domain without expanding them", () => {
  const { model } = parseModelDoc();
  const report = exploreModel(model, { depth: 3 });
  // Incrementing at 100 leaves `count: integer in 0..100`; that state is still
  // visited and checked, it is simply not walked further.
  assert.ok(report.outsideDomain > 0, "the frontier is reached");
  const violated = exploreModel(
    parseModelDoc(MODEL_DOC.replace("check: count >= 0", "check: count <= 100")).model,
    { depth: 3 },
  );
  assert.ok(
    violated.violations.some((v) => v.element.id === "INV-1"),
    "an invariant broken past the domain is still caught",
  );
});

test("exploreModel flags a property nothing exercised", () => {
  const doc = MODEL_DOC.replace(
    "BP-1 Increment steps by one:\n  requirement: FR-1\n  check: after AC-1, count = count@pre + 1",
    "BP-1 Increment steps by one:\n  requirement: FR-1\n  check: after AC-1, count = count@pre + 1\n\nBP-3 Unreachable claim:\n  requirement: FR-1\n  check: after AC-1, count = count@pre + 1",
  );
  const { model } = parseModelDoc(doc);
  // Depth 0 means no transition is ever taken, so no `after` claim triggers.
  const report = exploreModel(model, { depth: 0 });
  assert.deepEqual(report.unexercised.map((p) => p.id).sort(), ["BP-1", "BP-3"]);
});

console.log("\nlint (model layer)");
function withModelSpec(doc, fn) {
  return withTempDir((dir) => {
    const file = join(dir, "thing.spec.md");
    writeFileSync(file, doc);
    return fn(dir, file);
  });
}

test("lint enforces contiguous MOD/AC/INV/BP ids", () => {
  withModelSpec(MODEL_DOC.replace("AC-3 Set(", "AC-7 Set("), (_dir, file) => {
    const { code, out } = run(["lint", file]);
    assert.equal(code, 1, out);
    assert.match(out, /expected AC-3 in this row, found AC-7/);
  });
  withModelSpec(MODEL_DOC.replace("model: MOD-1 Counter", "model: MOD-2 Counter"), (_dir, file) => {
    const { out } = run(["lint", file]);
    assert.match(out, /expected MOD-1 in this row, found MOD-2/);
  });
});

test("lint errors on a TC citing a model id that does not exist", () => {
  withModelSpec(MODEL_DOC.replace("| TC-3 | FR-3, AC-3 |", "| TC-3 | FR-3, AC-8 |"), (_dir, file) => {
    const { code, out } = run(["lint", file]);
    assert.equal(code, 1, out);
    assert.match(out, /TC-3 references AC-8, which the behavioral model does not declare/);
  });
});

test("lint errors on a model citation in a spec with no model", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: No model\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1, AC-1 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /but this spec declares no behavioral model/);
    },
  );
});

test("lint warns when a Behavioral Model section holds no model block", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Empty model\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n\n### Behavioral Model\n\nComing soon.\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 0, out);
      assert.match(out, /declares no ```spec-model block/);
      assert.equal(run(["lint", "--strict", file]).code, 1);
    },
  );
});

test("lint warns when a model's adapter path is missing", () => {
  withModelSpec(MODEL_DOC, (_dir, file) => {
    const { code, out } = run(["lint", file]);
    assert.equal(code, 0, out); // a warning, not an error
    assert.match(out, /`adapter` path does not exist/);
  });
});

console.log("\ndrift");
const driftFor = (doc) => {
  const { models } = parseModels(doc, 0);
  return withModelSpec(doc, (_dir, file) => driftWarnings(parseSpec(file), models).map((p) => p.msg));
};

test("a model in step with its requirements raises no drift warning", () => {
  assert.deepEqual(driftFor(MODEL_DOC), []);
});

test("drift flags a requirement whose number and bound the model does not carry", () => {
  const messages = driftFor(
    MODEL_DOC.replace(
      "| FR-1 | Incrementing increases the counter by one |",
      "| FR-1 | [UPDATED] Incrementing increases the counter by one, up to a maximum of 100 |",
    ),
  );
  assert.ok(messages.some((m) => /FR-1 mentions 100/.test(m)), messages);
  assert.ok(messages.some((m) => /constrains behavior \("maximum"\)/.test(m)), messages);
  assert.ok(messages.some((m) => /marked \[UPDATED\]/.test(m)), messages);
});

test("drift flags an untraceable model element and dead state", () => {
  const messages = driftFor(
    MODEL_DOC.replace("AC-1 Increment:\n  requirement: FR-1\n", "AC-1 Increment:\n").replace(
      "  status: string in [idle, busy] = idle",
      "  status: string in [idle, busy] = idle\n  spare: integer in 0..1 = 0",
    ),
  );
  assert.ok(messages.some((m) => /AC-1 cites no Functional Requirement/.test(m)), messages);
  assert.ok(messages.some((m) => /"spare" in MOD-1 is never updated/.test(m)), messages);
});

test("--no-drift silences the heuristics", () => {
  const drifted = MODEL_DOC.replace(
    "| FR-1 | Incrementing increases the counter by one |",
    "| FR-1 | Incrementing increases the counter by one, up to a maximum of 100 |",
  );
  withModelSpec(drifted, (_dir, file) => {
    assert.match(run(["lint", file]).out, /requirement\/model drift/);
    const quiet = run(["lint", "--no-drift", file]);
    assert.doesNotMatch(quiet.out, /requirement\/model drift/);
  });
});

console.log("\nmodel CLI");
test("model check explores the pizza example clean", () => {
  const { code, out } = run(["model", "check", exampleSpec]);
  assert.equal(code, 0, out);
  assert.match(out, /MOD-1 Orders/);
  assert.match(out, /2\/2 properties exercised/);
  assert.match(out, /0 violation\(s\)/);
  assert.match(out, /at the domain frontier/);
});

test("model check reports a violation as a minimal counterexample", () => {
  withModelSpec(MODEL_DOC.replace("check: count >= 0", "check: count <= 50"), (dir) => {
    const { code, out } = run(["model", "check", dir]);
    assert.equal(code, 1, out);
    assert.match(out, /Invariant violated/);
    assert.match(out, /Minimal counterexample:/);
    assert.match(out, /Possible resolutions:/);
  });
});

test("model list prints the contract with its FR traces", () => {
  const { code, out } = run(["model", "list", exampleSpec]);
  assert.equal(code, 0, out);
  assert.match(out, /AC-1 AddItem\(sizeMultiplier: number in \[1, 1\.3, 1\.6\]/);
  assert.match(out, /BP-1 .*after AC-1, total = total@pre \+/);
  assert.match(out, /→ FR-2/);
});

test("model check defaults to check and says so when there is nothing to explore", () => {
  const plain = run(["model", exampleSpec]);
  assert.equal(plain.code, 0, plain.out);
  assert.match(plain.out, /MOD-1 Orders/);
  withTempSpec(
    `---\ntype: Spec\ntitle: No model\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | x |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (dir) => {
      const none = run(["model", "check", dir]);
      assert.equal(none.code, 0, none.out);
      assert.match(none.out, /No behavioral models declared/);
    },
  );
});

test("model bounds flags are validated", () => {
  const { code, out } = run(["model", "check", "--depth", "nope", exampleSpec]);
  assert.equal(code, 2, out);
  assert.match(out, /--depth must be a non-negative integer/);
});

test("check runs the model step and --no-model skips it", () => {
  const full = run(["check", exampleSpec]);
  assert.equal(full.code, 0, full.out);
  assert.match(full.out, /Checking behavioral models/);
  const skipped = run(["check", "--no-model", exampleSpec]);
  assert.equal(skipped.code, 0, skipped.out);
  assert.doesNotMatch(skipped.out, /Checking behavioral models/);
});

test("new --model scaffolds a model that lints and explores clean", () => {
  withTempDir((dir) => {
    const out = join(dir, "widget.spec.md");
    const created = run(["new", "widget", "--model", "--out", out]);
    assert.equal(created.code, 0, created.out);
    assert.match(readFileSync(out, "utf8"), /```spec-model/);
    const linted = run(["lint", out]);
    assert.equal(linted.code, 0, linted.out); // warnings ok, no errors
    const checked = run(["model", "check", out]);
    assert.equal(checked.code, 0, checked.out);
    // The default scaffold stays model-free.
    const plain = join(dir, "plain.spec.md");
    run(["new", "plain", "--out", plain]);
    assert.doesNotMatch(readFileSync(plain, "utf8"), /spec-model/);
  });
});

console.log("\nconformance");
atest("the pizza example conforms to its model", async () => {
  const { spec } = lintSpec(join(exampleSpec, "specs/order.spec.md"));
  const model = spec.models[0];
  const { adapter, error } = await loadAdapter(spec.filePath, model);
  assert.ok(adapter, error);
  const report = await runConformance(model, adapter, { depth: 2, maxTraces: 60 });
  assert.equal(report.failure, null, JSON.stringify(report.failure));
  assert.ok(report.stepsRun > 0);
  // `total` is only observable once an order is priced, but some trace places one.
  assert.deepEqual(report.unobserved, [], "every model variable is observed");
});

/** A copy of the pizza example whose implementation can be patched. */
async function withPatchedExample(patch, fn) {
  await withTempDir(async (dir) => {
    cpSync(exampleSpec, dir, { recursive: true });
    const file = join(dir, "src/orders/orders.ts");
    const source = readFileSync(file, "utf8");
    const patched = patch(source);
    assert.notEqual(patched, source, "the patch must actually change the implementation");
    writeFileSync(file, patched);
    await fn(dir);
  });
}

atest("conformance reports the minimal counterexample for a drifted implementation", async () => {
  // Capping the order total is the kind of change no reviewer blinks at, and no
  // unit test notices: TC-4's order comes to 4420, comfortably under the cap.
  await withPatchedExample(
    (source) =>
      source.replace(
        "const total = items.reduce((sum, item) => sum + item.lineTotal, 0);",
        "const total = Math.min(items.reduce((sum, item) => sum + item.lineTotal, 0), 5000);",
      ),
    (dir) => {
      const { code, out } = run(["model", "test", dir]);
      assert.equal(code, 1, out);
      assert.match(out, /Behavioral conformance failed/);
      assert.match(out, /AC-1 AddItem/);
      assert.match(out, /AC-2 PlaceOrder/);
      assert.match(out, /total = 5000/);
      // The wrong value is owned by AC-1, not by the action that surfaced it.
      assert.match(out, /Relevant contract:[\s\S]*AC-1: total' =/);
      assert.match(out, /Restore implementation behavior so it still follows AC-1/);
    },
  );
});

atest("conformance compares what was persisted, not what create returned", async () => {
  // An off-by-one in the stored order is invisible to a caller that only reads
  // the return value; `observe` reads it back out of the store.
  await withPatchedExample(
    (source) => source.replace("items,\n      total,", "items,\n      total: total + 1,"),
    (dir) => {
      const { code, out } = run(["model", "test", dir]);
      assert.equal(code, 1, out);
      assert.match(out, /Behavioral conformance failed/);
    },
  );
});

atest("an incomplete adapter is reported, not silently skipped", async () => {
  await withTempDir(async (dir) => {
    cpSync(exampleSpec, dir, { recursive: true });
    writeFileSync(
      join(dir, "model/orders.adapter.mjs"),
      `export default { init: () => ({}), actions: {}, observe: () => ({}) };\n`,
    );
    const { code, out } = run(["model", "test", dir]);
    assert.equal(code, 1, out);
    assert.match(out, /no handler for AC-1, AC-2/);
  });
});

atest("a model with no adapter is skipped by model test, not failed", async () => {
  await withModelSpec(MODEL_DOC.replace("adapter: ./counter.adapter.mjs\n", ""), async (dir) => {
    const { code, out } = run(["model", "test", dir]);
    assert.equal(code, 0, out);
    assert.match(out, /no `adapter` declared/);
    assert.match(out, /1 without an adapter/);
  });
});

await runAsyncTests();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
