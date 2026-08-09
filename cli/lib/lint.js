import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseFrontmatter, parseSpec, pathList } from "./parse.js";

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * FR tables must list ids as FR-1 .. FR-n in ascending order with no skips.
 * Position i (0-based) must be exactly `FR-${i + 1}`.
 * TC ids are opaque and stable — they are not sequenced (see ids.js).
 */
export function checkIdSequence(rows, prefix, label, err) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.valid) continue;
    const expected = `${prefix}-${i + 1}`;
    if (row.id !== expected) {
      err(
        `${label} ids must be contiguous and ascending from ${prefix}-1 ` +
          `(expected ${expected} in this row, found ${row.id})`,
        row.line,
      );
    }
  }
}

function eachResource(value, fn) {
  if (value == null || value === "") return;
  const values = Array.isArray(value) ? value : [value];
  for (const raw of values) {
    const resource = String(raw).trim();
    if (!resource) continue;
    fn(resource);
  }
}

/**
 * Lint a single spec file. Returns { filePath, problems, spec, stats }.
 * Each problem is { level: "error"|"warn", msg, line }.
 *
 * opts.requireApproved — approval state lives on the review record: the
 * spec's `review` key points at it, and the gate reads the record's
 * `status`. Errors when a linked record declares a `status` other than
 * "approved". Specs with no `review` key — and records with no `status`
 * (notices) — are not gated: the review lifecycle is opt-in per spec.
 */
export function lintSpec(filePath, opts = {}) {
  const spec = parseSpec(filePath);
  const problems = [];
  const dir = dirname(filePath);
  const fm = spec.frontmatter;

  const err = (msg, line) => problems.push({ level: "error", msg, line });
  const warn = (msg, line) => problems.push({ level: "warn", msg, line });

  // --- Frontmatter ---
  if (!spec.hasFrontmatter) {
    err("Missing YAML frontmatter block (--- ... ---)", 1);
  }
  if (!fm.type) {
    err("Frontmatter is missing required key `type`", 1);
  } else if (fm.type !== "Spec") {
    err(`Frontmatter \`type\` must be "Spec" (found "${fm.type}")`, 1);
  }
  if (!fm.title) {
    err("Frontmatter is missing required key `title`", 1);
  }
  if (fm.timestamp && !ISO_RE.test(String(fm.timestamp))) {
    warn(`\`timestamp\` is not a valid ISO 8601 date: "${fm.timestamp}"`, 1);
  }
  eachResource(fm.resource, (resource) => {
    if (!URL_RE.test(resource)) {
      warn(`\`resource\` is not a valid URL: "${resource}"`, 1);
    }
  });

  const reviews = new Map();

  // sources / tests / review paths should resolve on disk. A `review` value
  // may also be a URL (a knowledge-base mirror), which is not checked.
  for (const field of ["sources", "tests", "review"]) {
    for (const p of pathList(fm[field])) {
      if (field === "review" && URL_RE.test(p)) continue;
      if (!existsSync(resolve(dir, p))) {
        warn(`\`${field}\` path does not exist (spec-relative): ${p}`, 1);
        continue;
      }
      if (field === "review") {
        const review = parseFrontmatter(readFileSync(resolve(dir, p), "utf8")).data;
        reviews.set(p, review);
        eachResource(review.resource, (resource) => {
          if (!URL_RE.test(resource)) {
            warn(`\`resource\` in review record ${p} is not a valid URL: "${resource}"`, 1);
          }
        });
      }
    }
  }

  // --- Review lifecycle (opt-in via --require-approved) ---
  if (opts.requireApproved) {
    for (const p of pathList(fm.review)) {
      if (URL_RE.test(p)) continue;
      const reviewPath = resolve(dir, p);
      if (!existsSync(reviewPath)) {
        err(`\`review\` points at a missing record: ${p} (--require-approved)`, 1);
        continue;
      }
      const review =
        reviews.get(p) ?? parseFrontmatter(readFileSync(reviewPath, "utf8")).data;
      if (review.status && review.status !== "approved") {
        err(`review record ${p} has status "${review.status}" — must be "approved" (--require-approved)`, 1);
      }
    }
  }

  // --- Functional Requirements ---
  if (!spec.sawFrTable) {
    warn("No Functional Requirements table found", null);
  }
  const frIds = new Set();
  for (const fr of spec.frs) {
    if (!fr.valid) {
      err(`Malformed requirement id "${fr.id}" (expected FR-<number>)`, fr.line);
    }
    if (frIds.has(fr.id)) {
      err(`Duplicate requirement id ${fr.id}`, fr.line);
    }
    frIds.add(fr.id);
  }
  checkIdSequence(spec.frs, "FR", "Functional Requirement", err);

  // --- QA Test Cases ---
  if (!spec.sawTcTable) {
    warn("No QA Test Cases table found", null);
  }
  const tcIds = new Set();
  const referencedFrs = new Set();
  for (const tc of spec.tcs) {
    if (!tc.valid) {
      err(
        `Malformed test-case id "${tc.id}" (expected TC-[A-Z0-9]{4}, e.g. TC-K7MF)`,
        tc.line,
      );
    }
    if (tcIds.has(tc.id)) {
      err(`Duplicate test-case id ${tc.id}`, tc.line);
    }
    tcIds.add(tc.id);

    if (tc.requirements.length === 0) {
      warn(`${tc.id} does not cite a Functional Requirement`, tc.line);
    }
    for (const ref of tc.requirements) {
      referencedFrs.add(ref);
      if (!frIds.has(ref)) {
        err(`${tc.id} references ${ref}, which has no Functional Requirement row`, tc.line);
      }
    }
  }
  // TC ids are stable opaque join keys — not row indices. Do not require
  // contiguous or ascending order.

  // Every FR should be proven by at least one TC.
  for (const fr of spec.frs) {
    if (!referencedFrs.has(fr.id)) {
      warn(`${fr.id} has no QA Test Case referencing it`, fr.line);
    }
  }

  return {
    filePath,
    problems,
    spec,
    stats: {
      frs: spec.frs.length,
      tcs: spec.tcs.length,
      errors: problems.filter((p) => p.level === "error").length,
      warnings: problems.filter((p) => p.level === "warn").length,
    },
  };
}
