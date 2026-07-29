const supportsColor =
  process.stdout.isTTY && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

const wrap = (code) => (s) => (supportsColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  gray: wrap("90"),
  bold: wrap("1"),
  dim: wrap("2"),
};

export const glyph = {
  ok: c.green("✓"),
  warn: c.yellow("▲"),
  err: c.red("✗"),
  bullet: c.gray("•"),
  arrow: c.gray("→"),
};

/** A simple horizontal bar for coverage percentages. */
export function bar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const full = "█".repeat(filled);
  const empty = "░".repeat(width - filled);
  const color = pct >= 100 ? c.green : pct >= 60 ? c.yellow : c.red;
  return color(full) + c.gray(empty);
}

export function relative(filePath, cwd = process.cwd()) {
  return filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;
}

/** A spec's name for a report header — the `Spec: ` title prefix is redundant there. */
export function specLabel(spec) {
  const title = spec.frontmatter?.title || relative(spec.filePath);
  return String(title).replace(/^Spec:\s*/i, "");
}
