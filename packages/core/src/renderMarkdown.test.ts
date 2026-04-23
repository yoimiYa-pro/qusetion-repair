import { describe, expect, it } from "vitest";
import { renderMistakeBatchToMarkdown } from "./renderMarkdown.js";
import type { MistakeNoteBatch } from "./types.js";

const sampleBatch: MistakeNoteBatch = {
  batch_title: "期中复习",
  items: [
    {
      title: "二次方程求根",
      subject: "数学",
      topic_tags: ["一元二次方程", "判别式"],
      stem: "若关于 x 的方程 x^2 - 2x + k = 0 有两个不等实根，求 k 的范围。",
      options: ["k < 1", "k ≤ 1", "k > 1", "k ≥ 1"],
      user_answer: "k ≤ 1",
      correct_answer: "k < 1",
      analysis: "有两个不等实根要求判别式 Δ = 4 - 4k > 0，故 k < 1。",
      formulas: ["\\Delta = b^2 - 4ac"],
      source_hint: "课堂练习 P12",
      difficulty: "medium",
      status: "draft",
    },
    {
      title: "文言文虚词",
      subject: "语文",
      topic_tags: ["文言虚词", "待确认"],
      stem: "下列句中「之」的用法相同的一组是？",
      analysis: "不确定处待确认：需结合原题选项核对。",
    },
  ],
};

describe("renderMistakeBatchToMarkdown", () => {
  it("matches snapshot for multi-item batch", () => {
    const md = renderMistakeBatchToMarkdown(sampleBatch, {
      createdAt: "2026-04-17",
      separator: "\n\n---\n\n",
    });
    expect(md).toMatchSnapshot();
  });

  it("选项区不重复 A/B 前缀（模型已写 A. 时只保留一层）", () => {
    const md = renderMistakeBatchToMarkdown(
      {
        items: [
          {
            title: "蛋白质结构",
            stem: "阅读选择题。",
            topic_tags: ["生物"],
            options: [
              "A. 传统蛋白质结构观测方法存在哪些弊端",
              "B. 人工智能算法预测蛋白质结构有何优势",
            ],
            analysis: "略",
          },
        ],
      },
      { createdAt: "2026-04-17" }
    );
    expect(md).not.toMatch(/A\.\s*A\./);
    expect(md).toMatch(/A\.\s*传统蛋白质结构观测方法/);
    expect(md).toMatch(/B\.\s*人工智能算法预测蛋白质结构/);
  });

  it("basic tier omits 解析, 知识点, title frontmatter, and 一级标题", () => {
    const md = renderMistakeBatchToMarkdown(
      {
        items: [
          {
            title: "示例",
            stem: "1+1=?",
            topic_tags: ["算术"],
            options: ["1", "2", "3"],
            analysis: "应被忽略",
          },
        ],
      },
      { createdAt: "2026-04-17", tier: "basic" }
    );
    expect(md).toContain("## 题干");
    expect(md).toContain("## 选项");
    expect(md).not.toContain("## 解析");
    expect(md).not.toContain("## 知识点");
    expect(md).toContain("output_tier: basic");
    expect(md).not.toMatch(/(^|\n)title:\s/);
    expect(md).not.toContain("# 示例");
  });
});
