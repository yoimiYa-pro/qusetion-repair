import { describe, expect, it } from "vitest";
import { formatAjvErrors, validateMistakeBatch, validateMistakeBatchForTier } from "./validate.js";

describe("validateMistakeBatch", () => {
  it("accepts a valid batch", () => {
    const res = validateMistakeBatch({
      items: [
        {
          title: "T",
          stem: "题干",
          analysis: "解析",
          topic_tags: ["tag"],
        },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.items).toHaveLength(1);
  });

  it("rejects empty items", () => {
    const res = validateMistakeBatch({ items: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(formatAjvErrors(res.errors)).toMatch(/items/);
  });

  it("rejects missing required fields", () => {
    const res = validateMistakeBatch({
      items: [{ title: "x", stem: "s", analysis: "a" }],
    });
    expect(res.ok).toBe(false);
  });
});

describe("validateMistakeBatchForTier basic", () => {
  it("accepts basic batch without analysis", () => {
    const res = validateMistakeBatchForTier(
      {
        items: [
          {
            title: "T",
            stem: "题干",
            topic_tags: ["标签"],
            options: ["A", "B"],
          },
        ],
      },
      "basic"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.items[0].stem).toBe("题干");
      expect(res.value.items[0].analysis).toBeUndefined();
    }
  });

  it("rejects analysis field in basic mode", () => {
    const res = validateMistakeBatchForTier(
      {
        items: [
          {
            title: "T",
            stem: "题干",
            topic_tags: [],
            analysis: "不应出现",
          },
        ],
      },
      "basic"
    );
    expect(res.ok).toBe(false);
  });
});
