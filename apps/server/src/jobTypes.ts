import type { OutputTier } from "@qusetion-repair/core";
import type { IngestKind } from "./ingest.js";
import type { LlmProviderId } from "./llmConfig.js";

export type JobStatus = "pending" | "processing" | "done" | "failed";

export interface JobRecord {
  id: string;
  /** 人类可读递增编号（从 1 起）；API 路径 `/jobs/:id` 在 `:id` 为纯数字时按编号解析 */
  seq?: number;
  status: JobStatus;
  kind: IngestKind;
  tier: OutputTier;
  llmProvider?: LlmProviderId;
  llmModel?: string;
  createdAt: string;
  error?: string;
  errorCode?: string;
  markdownFilename?: string;
}

export interface CreateJobInput {
  kind: IngestKind;
  tier?: OutputTier;
  llmProvider?: string;
  llmModel?: string;
  textContent?: string;
  files: { filename: string; mimetype: string; buffer: Buffer }[];
}
