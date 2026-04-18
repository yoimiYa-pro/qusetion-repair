import { describe, expect, it } from "vitest";
import { stripRedundantChoicePrefix } from "./optionLabels.js";

describe("stripRedundantChoicePrefix", () => {
  it("removes duplicate A/B labels", () => {
    expect(stripRedundantChoicePrefix("A. A. 传统蛋白质", 0)).toBe("传统蛋白质");
    expect(stripRedundantChoicePrefix("B. B. 人工智能", 1)).toBe("人工智能");
  });

  it("supports fullwidth punctuation and parentheses", () => {
    expect(stripRedundantChoicePrefix("（A）．正文", 0)).toBe("正文");
    expect(stripRedundantChoicePrefix("(B)、第二项", 1)).toBe("第二项");
  });

  it("does not strip when letter does not match index", () => {
    expect(stripRedundantChoicePrefix("B. 误放在第一项", 0)).toBe("B. 误放在第一项");
  });

  it("leaves plain text unchanged", () => {
    expect(stripRedundantChoicePrefix("k < 1", 0)).toBe("k < 1");
    expect(stripRedundantChoicePrefix("仅正文无序号", 2)).toBe("仅正文无序号");
  });
});
