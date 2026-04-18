export type MistakeDifficulty = "easy" | "medium" | "hard" | "unknown";
export type MistakeStatus = "draft" | "reviewed" | "archived";

/** 输出层级：基础仅题干+选项；进阶为完整笔记 */
export type OutputTier = "basic" | "advanced";

export interface MistakeItem {
  title: string;
  subject?: string;
  topic_tags: string[];
  stem: string;
  options?: string[];
  user_answer?: string;
  correct_answer?: string;
  /** 基础模式可由模型省略 */
  analysis?: string;
  formulas?: string[];
  source_hint?: string;
  difficulty?: MistakeDifficulty;
  status?: MistakeStatus;
}

export interface MistakeNoteBatch {
  items: MistakeItem[];
  batch_title?: string;
}
