import { stripRedundantChoicePrefix } from "./optionLabels.js";
import type { MistakeItem, MistakeNoteBatch, OutputTier } from "./types.js";

function yamlScalar(s: string): string {
  if (s.includes("\n")) {
    return `|\n  ${s.replace(/\n/g, "\n  ")}`;
  }
  return JSON.stringify(s);
}

function yamlBlockList(key: string, items: string[]): string[] {
  if (!items.length) return [`${key}: []`];
  return [`${key}:`, ...items.map((t) => `  - ${yamlScalar(t)}`)];
}

function frontmatter(item: MistakeItem, index: number, createdAt: string): string {
  const tags = item.topic_tags?.length ? item.topic_tags : ["错题"];
  const lines = [
    "---",
    `title: ${yamlScalar(item.title)}`,
    `date: ${yamlScalar(createdAt)}`,
    `subject: ${yamlScalar(item.subject ?? "未分类")}`,
    ...yamlBlockList("tags", tags),
    `difficulty: ${yamlScalar(item.difficulty ?? "unknown")}`,
    `status: ${yamlScalar(item.status ?? "draft")}`,
    `mistake_index: ${index + 1}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function frontmatterBasic(item: MistakeItem, index: number, createdAt: string): string {
  const tags = item.topic_tags?.length ? item.topic_tags : ["错题"];
  const lines = [
    "---",
    `date: ${yamlScalar(createdAt)}`,
    ...yamlBlockList("tags", tags),
    `output_tier: basic`,
    `mistake_index: ${index + 1}`,
    "---",
    "",
  ];
  return lines.join("\n");
}

function section(title: string, body: string | undefined): string {
  if (body === undefined || body === "") return "";
  return `## ${title}\n\n${body.trim()}\n\n`;
}

function renderOneItem(item: MistakeItem, index: number, createdAt: string): string {
  const fm = frontmatter(item, index, createdAt);
  let md = `${fm}# ${item.title}\n\n`;
  if (item.source_hint) {
    md += `> 来源提示：${item.source_hint}\n\n`;
  }
  md += section("题干", item.stem);
  if (item.options?.length) {
    const opts = item.options
      .map((o, i) => `${String.fromCharCode(65 + i)}. ${stripRedundantChoicePrefix(o, i)}`)
      .join("\n\n");
    md += section("选项", opts);
  }
  const answerBlock = [
    item.user_answer !== undefined && item.user_answer !== ""
      ? `**我的答案：** ${item.user_answer}`
      : null,
    item.correct_answer !== undefined && item.correct_answer !== ""
      ? `**参考答案：** ${item.correct_answer}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  md += section("作答", answerBlock || undefined);
  md += section("解析", item.analysis);
  if (item.formulas?.length) {
    md += section("公式 / LaTeX", item.formulas.map((f) => `- $${f}$`).join("\n"));
  }
  const topics = item.topic_tags?.length ? item.topic_tags.join("、") : "";
  md += section("知识点", topics || undefined);
  return md.trimEnd() + "\n";
}

/** 基础模式：仅题干与选项 */
function renderOneItemBasic(item: MistakeItem, index: number, createdAt: string): string {
  const fm = frontmatterBasic(item, index, createdAt);
  let md = `${fm}`;
  md += section("题干", item.stem);
  if (item.options?.length) {
    const opts = item.options
      .map((o, i) => `${String.fromCharCode(65 + i)}. ${stripRedundantChoicePrefix(o, i)}`)
      .join("\n\n");
    md += section("选项", opts);
  }
  return md.trimEnd() + "\n";
}

export interface RenderMarkdownOptions {
  /** ISO date (YYYY-MM-DD) for frontmatter */
  createdAt?: string;
  /** Separator between multiple mistakes in one file */
  separator?: string;
  /** 基础：仅题干+选项；进阶：完整区块 */
  tier?: OutputTier;
}

export function renderMistakeBatchToMarkdown(
  batch: MistakeNoteBatch,
  options: RenderMarkdownOptions = {}
): string {
  const createdAt = options.createdAt ?? new Date().toISOString().slice(0, 10);
  const sep = options.separator ?? "\n\n---\n\n";
  const tier = options.tier ?? "advanced";
  const header = batch.batch_title
    ? `<!-- batch: ${batch.batch_title.replace(/--/g, "—")} -->\n\n`
    : "";
  const renderOne = tier === "basic" ? renderOneItemBasic : renderOneItem;
  const parts = batch.items.map((item, i) => renderOne(item, i, createdAt));
  return (header + parts.join(sep)).trim() + "\n";
}
