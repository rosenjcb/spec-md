#!/usr/bin/env node
/**
 * Single-source packaging: SKILL.md is the canonical skill (TESTING.md is its
 * standalone companion doc, linked, never duplicated). This script projects
 * SKILL.md into every agent-specific adapter so nothing drifts.
 *
 * Claude Code plugin layout (single skill): root SKILL.md — do NOT also put a
 * copy under skills/<name>/ (that yields the redundant /spec-md:spec-md stem
 * under plugin name spec-md). Portable Agent Skills go to .agents/skills/<name>/.
 *
 *   node scripts/sync-adapters.mjs           # write all adapters
 *   node scripts/sync-adapters.mjs --check   # verify they are up to date (CI)
 *
 * Never edit the generated files by hand — edit SKILL.md and re-run this.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const GH_BLOB = "https://github.com/rosenjcb/spec.md/blob/main";

export const adapterBanner = (source) =>
  `<!-- GENERATED FROM ${source} — do not edit. Run: pnpm run sync (or node scripts/sync-adapters.mjs) -->`;

/** Split leading `--- ... ---` frontmatter from a markdown file. */
export function splitSkillMarkdown(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { fm: {}, body: text.trim() };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { fm, body: text.slice(m[0].length).trim() };
}

function intro(agent) {
  return (
    `${adapterBanner("SKILL.md")}\n\n> This guide teaches ${agent} to author and maintain \`*.spec.md\` files — ` +
    `the [spec-md](https://github.com/rosenjcb/spec.md) format. It is generated from the canonical ` +
    `[SKILL.md](${GH_BLOB}/SKILL.md); see it and [TESTING.md](${GH_BLOB}/TESTING.md) for the source of truth.\n`
  );
}

/** @param {string} skillRaw */
export function buildAdapterOutputs(skillRaw) {
  const { fm, body } = splitSkillMarkdown(skillRaw);
  const skillName = fm.name || "spec-md";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new Error(
      `SKILL.md frontmatter name must be a lowercase kebab id; got ${JSON.stringify(skillName)}`
    );
  }
  const description =
    fm.description ||
    "Author or update *.spec.md files — Open Knowledge Format specs that keep intent, behavior, and verification aligned.";

  return [
    {
      // Portable Agent Skills path — Cursor, Codex, and other agentskills.io clients.
      path: `.agents/skills/${skillName}/SKILL.md`,
      content: skillRaw.trimEnd() + "\n",
    },
    {
      path: "AGENTS.md",
      content:
        `# AGENTS.md — spec-md\n\n${adapterBanner("SKILL.md")}\n\n` +
        `When working with \`*.spec.md\` files in this repository, follow the rules below.\n\n` +
        `---\n\n${body}\n`,
    },
    {
      path: ".cursor/rules/spec-md.mdc",
      content:
        `---\ndescription: ${description}\nglobs: **/*.spec.md\nalwaysApply: false\n---\n\n` +
        `${intro("Cursor")}\n---\n\n${body}\n`,
    },
    {
      path: ".windsurf/rules/spec-md.md",
      content:
        `---\ntrigger: glob\nglobs: **/*.spec.md\ndescription: ${description}\n---\n\n` +
        `${intro("Windsurf")}\n---\n\n${body}\n`,
    },
    {
      path: ".clinerules/spec-md.md",
      content: `# spec-md rules\n\n${intro("Cline")}\n---\n\n${body}\n`,
    },
    {
      path: ".github/copilot-instructions.md",
      content:
        `# Copilot instructions — spec-md\n\n${adapterBanner("SKILL.md")}\n\n` +
        `This repository uses the [spec-md](https://github.com/rosenjcb/spec.md) format. ` +
        `When creating or editing \`*.spec.md\` files, follow these rules.\n\n---\n\n${body}\n`,
    },
  ];
}

/**
 * @param {string} root
 * @param {{ check?: boolean }} [options]
 * @returns {{ wrote: number, drift: string[] }}
 */
export function syncAdapters(root, { check = false } = {}) {
  const skillRaw = readFileSync(join(root, "SKILL.md"), "utf8");
  const outputs = buildAdapterOutputs(skillRaw);
  const drift = [];
  let wrote = 0;

  for (const { path: relPath, content } of outputs) {
    const abs = join(root, relPath);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (current === content) continue;
    if (check) {
      drift.push(relPath);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      wrote++;
    }
  }

  return { wrote, drift };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const check = process.argv.includes("--check");
  const { wrote, drift } = syncAdapters(root, { check });

  if (check) {
    if (drift.length) {
      for (const relPath of drift) {
        console.error(`✗ out of date: ${relPath}`);
      }
      console.error(`\n${drift.length} adapter(s) out of date. Run: pnpm run sync`);
      process.exit(1);
    }
    console.log("✓ all adapters are in sync with SKILL.md");
    return;
  }

  if (wrote) {
    console.log(`\n${wrote} file(s) updated.`);
  } else {
    console.log("\nAlready up to date.");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
