#!/usr/bin/env node
// Zero-dependency test runner for the spec-md CLI and libraries.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import {
  parseFrontmatter,
  pathList,
  parseTables,
  extractTcTags,
} from "../lib/parse.js";
import { bar, relative } from "../lib/report.js";
import { findSpecs, walkFiles } from "../lib/walk.js";
import { specTemplate } from "../lib/template.js";

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
