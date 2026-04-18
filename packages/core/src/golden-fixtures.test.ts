import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMistakeBatchToMarkdown } from "./renderMarkdown.js";
import { validateMistakeBatch } from "./validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures");

describe("golden fixtures", () => {
  it("golden-model-output.json validates and renders deterministically", async () => {
    const raw = await readFile(join(fixturesDir, "golden-model-output.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const v = validateMistakeBatch(parsed);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const md = renderMistakeBatchToMarkdown(v.value, { createdAt: "2026-04-17" });
    expect(md).toMatchSnapshot();
  });

  it("all golden-*.txt fixtures are non-empty", async () => {
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(fixturesDir);
    const txts = names.filter((n) => n.startsWith("golden-") && n.endsWith(".txt"));
    expect(txts.length).toBeGreaterThanOrEqual(5);
    for (const n of txts) {
      const s = await readFile(join(fixturesDir, n), "utf8");
      expect(s.trim().length).toBeGreaterThan(10);
    }
  });
});
