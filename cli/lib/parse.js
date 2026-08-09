import { readFileSync } from "node:fs";

/**
 * Minimal, dependency-free parser for a *.spec.md document.
 * It is intentionally lenient: it extracts the structure spec-md cares about
 * (frontmatter, FR-N rows, TC ids) without pulling in a full YAML/Markdown
 * stack. It is not a validator — lint.js interprets the result.
 */

/** Stable test-case id: `TC-` + four uppercase base36 characters. */
export const TC_ID_RE = /^TC-[A-Z0-9]{4}$/;

const ID_RE = {
  fr: /^FR-\d+$/,
  tc: TC_ID_RE,
};

const MARKER_RE = /\[(REMOVED|NEW|UPDATED)\]/g;

/** Split a `key: value` frontmatter line, honoring inline `[a, b]` arrays. */
function parseScalar(raw) {
  let value = raw.trim();
  // Strip surrounding quotes.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  // Inline array: [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return value;
}

/** Parse the leading `--- ... ---` YAML-ish frontmatter block. */
export function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  if (!match) return { data: {}, hasFrontmatter: false, endLine: 0 };
  const body = match[1];
  const data = {};
  let currentKey = null;
  for (const line of body.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    // Block list item ("  - foo") continuing the previous key.
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(parseScalar(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const rawValue = kv[2];
      data[currentKey] = rawValue === "" ? "" : parseScalar(rawValue);
    }
  }
  const endLine = match[0].split("\n").length;
  return { data, hasFrontmatter: true, endLine };
}

/** Turn a frontmatter path field (YAML list, or a single scalar path) into a clean array. */
export function pathList(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  const single = String(value).trim();
  return single ? [single] : [];
}

/** Parse GitHub-flavored Markdown table rows into arrays of trimmed cells. */
function parseTableRows(lines, startIdx) {
  const rows = [];
  let i = startIdx;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    rows.push(cells);
  }
  return { rows, next: i };
}

const isSeparatorRow = (cells) => cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "");

/**
 * Extract FR-N and TC tables from the document body.
 * We identify a table by its header cells, then read the id-bearing column.
 */
export function parseTables(text, frontmatterLines = 0) {
  const lines = text.split("\n");
  const frs = [];
  const tcs = [];
  let sawFrTable = false;
  let sawTcTable = false;

  for (let i = frontmatterLines; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    const { rows, next } = parseTableRows(lines, i);
    if (rows.length < 1) {
      i = next - 1;
      continue;
    }
    const header = rows[0].map((c) => c.toLowerCase());
    const bodyRows = rows
      .slice(1)
      .filter((r) => !isSeparatorRow(r) && r.some((c) => c !== ""));
    const lineOf = (rowIdx) => i + 1 + rowIdx; // 1-indexed source line

    // Functional Requirements table: first column holds FR-N.
    if (header[0] === "id" && header.some((h) => h.includes("requirement"))) {
      sawFrTable = true;
      bodyRows.forEach((cells, idx) => {
        const id = (cells[0] || "").replace(MARKER_RE, "").trim();
        if (!id) return;
        frs.push({
          id,
          valid: ID_RE.fr.test(id),
          text: cells.slice(1).join(" | "),
          markers: [...(cells.join(" ").matchAll(MARKER_RE))].map((m) => m[1]),
          removed: /\[REMOVED\]/.test(cells.join(" ")),
          line: lineOf(idx + 1),
        });
      });
    }
    // QA Test Cases table: "Test ID" column plus a "Requirement" column.
    else if (
      header.some((h) => h.includes("test id") || h === "id") &&
      header.some((h) => h.includes("requirement")) &&
      header.some((h) => h.includes("scenario") || h.includes("outcome"))
    ) {
      sawTcTable = true;
      const reqCol = header.findIndex((h) => h.includes("requirement"));
      bodyRows.forEach((cells, idx) => {
        const id = (cells[0] || "").replace(MARKER_RE, "").trim();
        if (!id) return;
        const reqCell = cells[reqCol] || "";
        const requirements = [...reqCell.matchAll(/FR-\d+/g)].map((m) => m[0]);
        tcs.push({
          id,
          valid: ID_RE.tc.test(id),
          requirements,
          reqRaw: reqCell.replace(MARKER_RE, "").trim(),
          scenario: cells[reqCol + 1] || "",
          expected: cells[reqCol + 2] || "",
          removed: /\[REMOVED\]/.test(cells.join(" ")),
          line: lineOf(idx + 1),
        });
      });
    }
    i = next - 1;
  }

  return { frs, tcs, sawFrTable, sawTcTable };
}

/** Full parse of a spec file from disk. */
export function parseSpec(filePath) {
  const text = readFileSync(filePath, "utf8");
  const { data, hasFrontmatter, endLine } = parseFrontmatter(text);
  const { frs, tcs, sawFrTable, sawTcTable } = parseTables(text, endLine);
  return {
    filePath,
    text,
    frontmatter: data,
    hasFrontmatter,
    frs,
    tcs,
    sawFrTable,
    sawTcTable,
  };
}

/** Collect every [TC-XXXX] tag mentioned in an arbitrary text blob. */
export function extractTcTags(text) {
  return new Set(
    [...text.matchAll(/\[(TC-[A-Z0-9]{4})\]/g)].map((m) => m[1]),
  );
}

export const ID_PATTERNS = ID_RE;
