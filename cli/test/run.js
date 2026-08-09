#!/usr/bin/env node
// Zero-dependency test runner for the spec-md CLI and libraries.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
import {
  generateTcId,
  isValidTcId,
  isLegacyTcId,
  tcIdentitySeed,
  planTcIdMigration,
  rewriteTcIds,
  migrateSpecIds,
} from "../lib/ids.js";
import { coverageForSpec } from "../lib/coverage.js";
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

const VALID_SPEC_BODY = `### Functional Requirements
| ID | Requirement |
|----|----|
| FR-1 | a |
### QA Test Cases
| Test ID | Requirement | Scenario | Expected Outcome |
|--|--|--|--|
| TC-K7MF | FR-1 | x | y |
`;

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
    `---\ntype: Spec\ntitle: Dup\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n| FR-1 | b |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-K7MF | FR-9 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /Duplicate requirement id FR-1/);
      assert.match(out, /references FR-9/);
    },
  );
});

test("lint flags skipped and out-of-order FR ids", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Jumbled FR\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n| FR-3 | b |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-K7MF | FR-1 | x | y |\n| TC-2QXR | FR-3 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /expected FR-2 in this row, found FR-3/);
    },
  );
});

test("lint accepts non-sequential stable TC ids and rejects legacy/numeric format", () => {
  // Gaps and any document order are fine for stable ids.
  withTempSpec(
    `---\ntype: Spec\ntitle: Stable\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-8PDA | FR-1 | x | y |\n| TC-K7MF | FR-1 | z | y |\n| TC-2QXR | FR-1 | w | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 0, out);
    },
  );
  // Sequential TC-N is no longer valid.
  withTempSpec(
    `---\ntype: Spec\ntitle: Legacy\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /Malformed test-case id "TC-1"/);
    },
  );
  // Lowercase / wrong length are invalid.
  withTempSpec(
    `---\ntype: Spec\ntitle: Bad form\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-k7mf | FR-1 | x | y |\n`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 1, out);
      assert.match(out, /Malformed test-case id/);
    },
  );
});

test("coverage --strict exits non-zero when a TC has no test", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Uncovered\n---\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-K7MF | FR-1 | x | y |\n`,
    (dir) => {
      const { code, out } = run(["coverage", "--strict", dir]);
      assert.equal(code, 1, out);
      assert.match(out, /uncovered/);
    },
  );
});

test("coverage matches [TC-XXXX] tags and reports orphans", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-cov-"));
  try {
    writeFileSync(
      join(dir, "thing.spec.md"),
      `---\ntype: Spec\ntitle: Cov\ntests: [./test]\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-K7MF | FR-1 | valid | ok |\n| TC-2QXR | FR-1 | missing | fail |\n`,
    );
    mkdirSync(join(dir, "test"));
    writeFileSync(
      join(dir, "test/a.test.js"),
      `it("[TC-K7MF] creates", () => {});\nit("[TC-ZZZZ] orphan", () => {});\n`,
    );
    const cov = coverageForSpec(join(dir, "thing.spec.md"));
    assert.deepEqual(cov.covered, ["TC-K7MF"]);
    assert.deepEqual(cov.uncovered, ["TC-2QXR"]);
    assert.deepEqual(cov.orphanTags, ["TC-ZZZZ"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lint --require-approved fails when the linked review is still open", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Draft thing\nreview: ./thing.review.md\n---\n${VALID_SPEC_BODY}`,
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
    `---\ntype: Spec\ntitle: Dangling\nreview: ./gone.review.md\n---\n${VALID_SPEC_BODY}`,
    (_dir, file) => {
      const { code, out } = run(["lint", "--require-approved", file]);
      assert.equal(code, 1, out);
      assert.match(out, /missing record/);
    },
  );
});

test("lint --require-approved passes approved, notice, and review-less specs", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: No review\n---\n${VALID_SPEC_BODY}`,
    (_dir, file) => {
      const { code, out } = run(["lint", "--require-approved", file]);
      assert.equal(code, 0, out);
    },
  );
  withTempSpec(
    `---\ntype: Spec\ntitle: Noticed\nreview: ./thing.review.md\n---\n${VALID_SPEC_BODY}`,
    (dir, file) => {
      writeFileSync(
        join(dir, "thing.review.md"),
        `---\ntype: Review\ntitle: "Review: Thing"\nspec: ./thing.spec.md\nmode: notice\n---\n`,
      );
      const { code, out } = run(["lint", "--require-approved", file]);
      assert.equal(code, 0, out);
    },
  );
  const { code, out } = run(["lint", "--require-approved", exampleSpec]);
  assert.equal(code, 0, out);
});

test("lint warns when a relative `review` path is missing, allows URLs", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Review paths\nreview: ./nope.review.md\n---\n${VALID_SPEC_BODY}`,
    (_dir, file) => {
      const { code, out } = run(["lint", file]);
      assert.equal(code, 0, out); // warning, not error
      assert.match(out, /`review` path does not exist/);
      const strict = run(["lint", "--strict", file]);
      assert.equal(strict.code, 1, strict.out);
    },
  );
  withTempSpec(
    `---\ntype: Spec\ntitle: Review URL\nreview: https://notion.example.com/page\n---\n${VALID_SPEC_BODY}`,
    (_dir, file) => {
      const { code, out } = run(["lint", "--strict", file]);
      assert.equal(code, 0, out);
    },
  );
});

test("lint validates `resource` URLs on specs and linked reviews", () => {
  withTempSpec(
    `---\ntype: Spec\ntitle: Resource fields\nresource: https://publish.example.com/spec\nreview: ./thing.review.md\n---\n${VALID_SPEC_BODY}`,
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
    `---\ntype: Spec\ntitle: Bad review resource\nreview: ./thing.review.md\n---\n${VALID_SPEC_BODY}`,
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
    const body = readFileSync(out, "utf8");
    assert.match(body, /TC-[A-Z0-9]{4}/);
    assert.doesNotMatch(body, /\| TC-1 \|/);
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

test("id generates a stable deterministic TC id", () => {
  const a = run(["id", "--requirement", "FR-4", "--scenario", "no customerId"]);
  const b = run(["id", "FR-4", "no customerId"]);
  assert.equal(a.code, 0, a.out);
  assert.equal(a.out.trim(), b.out.trim());
  assert.match(a.out.trim(), /^TC-[A-Z0-9]{4}$/);
});

test("migrate-ids rewrites legacy numeric ids and tags", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-mig-"));
  try {
    writeFileSync(
      join(dir, "thing.spec.md"),
      `---\ntype: Spec\ntitle: Mig\ntests: [./test]\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | valid order | created |\n| TC-2 | FR-1 | missing customer | rejected |\n| TC-10 | FR-1 | large size | multiplied |\n`,
    );
    mkdirSync(join(dir, "test"));
    writeFileSync(
      join(dir, "test/a.test.js"),
      `it("[TC-1] creates", () => {});\nit("[TC-2] rejects", () => {});\nit("[TC-10] prices", () => {});\n`,
    );

    const r1 = run(["migrate-ids", dir]);
    assert.equal(r1.code, 0, r1.out);

    const spec = readFileSync(join(dir, "thing.spec.md"), "utf8");
    const tests = readFileSync(join(dir, "test/a.test.js"), "utf8");
    assert.doesNotMatch(spec, /\| TC-\d+ \|/);
    assert.match(spec, /TC-[A-Z0-9]{4}/);
    assert.doesNotMatch(tests, /\[TC-\d+\]/);
    assert.match(tests, /\[TC-[A-Z0-9]{4}\]/);

    // TC-1 must not clobber TC-10 during rewrite.
    const tags = [...extractTcTags(tests)];
    assert.equal(tags.length, 3);

    // Idempotent.
    const r2 = run(["migrate-ids", dir]);
    assert.equal(r2.code, 0, r2.out);
    assert.match(r2.out, /already stable/);

    // Lint + coverage pass.
    const check = run(["check", dir]);
    assert.equal(check.code, 0, check.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("help and version work", () => {
  assert.equal(run(["--version"]).code, 0);
  assert.match(run(["--help"]).out, /Usage/);
  assert.match(run(["--help"]).out, /migrate-ids/);
});

console.log("\nids");
test("isValidTcId accepts TC-XXXX format", () => {
  assert.equal(isValidTcId("TC-K7MF"), true);
  assert.equal(isValidTcId("TC-2QXR"), true);
  assert.equal(isValidTcId("TC-0000"), true);
  assert.equal(isValidTcId("TC-ZZZZ"), true);
  assert.equal(isValidTcId("TC-1"), false);
  assert.equal(isValidTcId("TC-123"), false);
  assert.equal(isValidTcId("TC-k7mf"), false);
  assert.equal(isValidTcId("TC-K7M!"), false);
  assert.equal(isValidTcId("TC-K7MFF"), false);
  assert.equal(isValidTcId("T-K7MF"), false);
  assert.equal(isLegacyTcId("TC-1"), true);
  assert.equal(isLegacyTcId("TC-K7MF"), false);
});

test("generateTcId is deterministic and collision-safe", () => {
  const seed = tcIdentitySeed("FR-4", "The request has no customerId");
  const a = generateTcId(seed);
  const b = generateTcId(seed);
  assert.equal(a, b);
  assert.match(a, /^TC-[A-Z0-9]{4}$/);

  // Force collision: mark the natural candidate as used.
  const forced = generateTcId(seed, [a]);
  assert.notEqual(forced, a);
  assert.match(forced, /^TC-[A-Z0-9]{4}$/);
});

test("rewriteTcIds does not partial-match TC-1 inside TC-10", () => {
  const map = new Map([
    ["TC-1", "TC-AAAA"],
    ["TC-10", "TC-BBBB"],
  ]);
  const out = rewriteTcIds("| TC-1 | TC-10 | [TC-1] [TC-10]", map);
  assert.equal(out, "| TC-AAAA | TC-BBBB | [TC-AAAA] [TC-BBBB]");
});

test("planTcIdMigration is idempotent on stable ids", () => {
  const plan = planTcIdMigration({
    tcs: [
      { id: "TC-K7MF", reqRaw: "FR-1", scenario: "valid", requirements: ["FR-1"] },
      { id: "TC-2QXR", reqRaw: "FR-1", scenario: "bad", requirements: ["FR-1"] },
    ],
  });
  assert.equal(plan.changes, 0);
  assert.equal(plan.collisions.length, 0);
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
| TC-K7MF | FR-1 | input | output |
`;
  const { frs, tcs, sawFrTable, sawTcTable } = parseTables(text);
  assert.equal(sawFrTable, true);
  assert.equal(sawTcTable, true);
  assert.equal(frs[0].id, "FR-1");
  assert.equal(tcs[0].id, "TC-K7MF");
  assert.equal(tcs[0].valid, true);
  assert.deepEqual(tcs[0].requirements, ["FR-1"]);
});

test("extractTcTags collects unique stable TC references", () => {
  const tags = extractTcTags(
    'it("[TC-K7MF] one", () => {}); it("[TC-K7MF] dup", () => {}); [TC-2QXR] [TC-1]',
  );
  assert.deepEqual([...tags].sort(), ["TC-2QXR", "TC-K7MF"]);
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
test("specTemplate scaffolds domain paths and stable FR/TC tables", () => {
  const body = specTemplate({ domain: "billing" });
  assert.match(body, /title: "Spec: Billing"/);
  assert.match(body, /sources: \[\.\/src\/billing\]/);
  assert.match(body, /FR-1/);
  assert.match(body, /TC-[A-Z0-9]{4}/);
  assert.doesNotMatch(body, /\| TC-1 \|/);
});

test("specTemplate renders multi-path flag values as YAML arrays", () => {
  const body = specTemplate({ domain: "billing", sources: "./src/billing, ./src/app.ts" });
  assert.match(body, /sources: \[\.\/src\/billing, \.\/src\/app\.ts\]/);
  assert.match(body, /tests: \[\.\/test\/billing\]/);
});

// Keep migrateSpecIds import used if CLI migration test ran; additionally unit-level dryRun.
test("migrateSpecIds dryRun plans without writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-md-dry-"));
  try {
    const file = join(dir, "thing.spec.md");
    writeFileSync(
      file,
      `---\ntype: Spec\ntitle: Dry\n---\n### Functional Requirements\n| ID | Requirement |\n|----|----|\n| FR-1 | a |\n### QA Test Cases\n| Test ID | Requirement | Scenario | Expected Outcome |\n|--|--|--|--|\n| TC-1 | FR-1 | s | e |\n`,
    );
    const result = migrateSpecIds(file, { dryRun: true });
    assert.equal(result.changed, true);
    assert.match(readFileSync(file, "utf8"), /\| TC-1 \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
