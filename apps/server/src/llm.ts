import OpenAI, { APIError, RateLimitError } from "openai";
import {
  formatAjvErrors,
  mistakeBatchBasicSchema,
  mistakeBatchSchema,
  validateMistakeBatchForTier,
  type MistakeNoteBatch,
  type OutputTier,
} from "@qusetion-repair/core";
import type { IngestResult } from "./ingest.js";
import type { LlmProviderId } from "./llmConfig.js";

const SYSTEM_PROMPT_ADVANCED = `你是资深教师，帮助用户把错题整理成结构化数据。
规则：
1. 只输出一个 JSON 对象，不要 Markdown 围栏，不要额外说明。
2. JSON 必须符合用户给定的 schema：根对象含 items 数组；每个 item 至少含 title、stem、analysis、topic_tags。
3. 若有 options 数组，每一项只写选项正文，不要写「A.」「B.」等序号（导出时会自动编号）。
4. 若图片/文本信息不足以判断答案或选项，请在 analysis 中写「待确认」并避免编造数值。
5. topic_tags 用简短中文短语；title 用简短概括。
6. 若有多道题，拆成多个 items。`;

const SYSTEM_PROMPT_BASIC = `你是助教，只做「识题录入」，不进行解析、不讲知识点、不推测答案。
规则：
1. 只输出一个 JSON 对象，不要 Markdown 围栏，不要额外说明。
2. 仅从材料中提取题干（stem）与选项（options，若有）。不要输出 analysis、答案、公式、点评等字段；schema 中也不包含这些键。
3. options 数组每一项只写选项正文，不要写「A.」「B.」「（A）」等序号（导出 Markdown 时会自动加 A/B/C）。
4. 每项须含 stem、topic_tags（可为空数组 []）；不要输出 title 字段，也不要输出答案、点评、解析类文字。
5. 无明确选项时 options 可省略或填空数组；题干不清处用「待确认」占位，不要编造。
6. 多道题拆成多个 items。`;

function buildUserContent(
  ingest: IngestResult,
  provider: LlmProviderId,
  tier: OutputTier
): OpenAI.Chat.ChatCompletionContentPart[] {
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  const textBlob = ingest.plainTextParts.filter(Boolean).join("\n\n---\n\n");
  if (textBlob) {
    parts.push({
      type: "text",
      text: `以下为用户提供的文本材料：\n\n${textBlob}`,
    });
  }
  const omitImageDetail = provider === "moonshot" || provider === "gemini";
  for (const img of ingest.imageParts) {
    const url = `data:${img.mime};base64,${img.base64}`;
    parts.push({
      type: "image_url",
      image_url: omitImageDetail ? { url } : { url, detail: "auto" },
    });
  }
  if (!parts.length) {
    parts.push({ type: "text", text: "（无有效输入）" });
  }
  const schema = tier === "basic" ? mistakeBatchBasicSchema : mistakeBatchSchema;
  const schemaName = tier === "basic" ? "MistakeNoteBatchBasic" : "MistakeNoteBatch";
  parts.push({
    type: "text",
    text: `请输出 JSON，schema 名称 ${schemaName}。字段说明：items 为数组；可选 batch_title。
JSON Schema（结构约束）：\n${JSON.stringify(schema, null, 2)}`,
  });
  return parts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveTemperature(provider: LlmProviderId): number {
  const raw = process.env.LLM_TEMPERATURE?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return provider === "moonshot" ? 1 : 0.2;
}

export interface AnalyzeOptions {
  apiKey: string;
  baseURL?: string;
  model: string;
  provider: LlmProviderId;
  /** 基础模式仅抽取题干与选项，降低模型输出量 */
  tier?: OutputTier;
  maxRetries?: number;
  timeoutMs?: number;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof RateLimitError || (err instanceof APIError && err.status === 429);
}

function retryAfterMs(err: unknown): number | null {
  if (!(err instanceof APIError) || !err.headers?.get) return null;
  const ra = err.headers.get("retry-after");
  if (!ra) return null;
  const sec = parseInt(ra, 10);
  if (Number.isNaN(sec) || sec < 1) return null;
  return sec * 1000;
}

/** 将上游 HTTP 错误转成可读文案与稳定 errorCode */
function wrapUpstreamError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (isRateLimitError(err)) {
    return new LlmError(
      "HTTP 429：已触发速率限制或配额（Gemini 免费层常见）。请间隔几分钟再试，或在 Google AI Studio 查看用量与配额：https://aistudio.google.com/",
      "LLM_RATE_LIMIT"
    );
  }
  if (err instanceof APIError) {
    if (err.status === 401 || err.status === 403) {
      return new LlmError(`HTTP ${err.status}：API 密钥无效或无权访问。`, "LLM_AUTH");
    }
    if (err.status === 503 || err.status === 502) {
      return new LlmError(`HTTP ${err.status}：模型服务暂时不可用，请稍后重试。`, "LLM_UNAVAILABLE");
    }
    const msg = err.message || `HTTP ${String(err.status)}`;
    return new LlmError(msg, "LLM_UPSTREAM");
  }
  if (err instanceof Error) return new LlmError(err.message, "LLM_UNKNOWN");
  return new LlmError(String(err), "LLM_UNKNOWN");
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new LlmError("模型返回不是合法 JSON 对象", "LLM_INVALID_JSON");
  }
  const slice = trimmed.slice(start, end + 1);
  return JSON.parse(slice) as unknown;
}

export async function analyzeIngestToBatch(
  ingest: IngestResult,
  options: AnalyzeOptions
): Promise<MistakeNoteBatch> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  });
  const model = options.model;
  const tier: OutputTier = options.tier ?? "advanced";
  const systemPrompt = tier === "basic" ? SYSTEM_PROMPT_BASIC : SYSTEM_PROMPT_ADVANCED;
  const maxRetries = options.maxRetries ?? 5;
  const timeoutMs = options.timeoutMs ?? 120_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const completion = await client.chat.completions.create(
        {
          model,
          temperature: resolveTemperature(options.provider),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: buildUserContent(ingest, options.provider, tier) },
          ],
        },
        { signal: controller.signal }
      );
      clearTimeout(timer);
      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new LlmError("模型未返回内容", "LLM_EMPTY");
      }
      let parsed: unknown;
      try {
        parsed = parseJsonObject(content);
      } catch (e) {
        throw new LlmError(
          e instanceof Error ? e.message : "JSON 解析失败",
          "LLM_INVALID_JSON"
        );
      }
      const validated = validateMistakeBatchForTier(parsed, tier);
      if (validated.ok) return validated.value;
      throw new LlmError(
        `JSON 未通过校验: ${formatAjvErrors(validated.errors)}`,
        "LLM_SCHEMA_MISMATCH"
      );
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof LlmError && err.code === "LLM_SCHEMA_MISMATCH" && attempt < maxRetries - 1) {
        lastErr = err;
        await sleep(400 * (attempt + 1));
        continue;
      }
      if (err instanceof Error && err.name === "AbortError") {
        lastErr = new LlmError("模型调用超时", "LLM_TIMEOUT");
        break;
      }
      if (isRateLimitError(err) && attempt < maxRetries - 1) {
        const fromHeader = retryAfterMs(err);
        const backoff = fromHeader ?? 6000 + attempt * 8000;
        await sleep(backoff);
        lastErr = err;
        continue;
      }
      lastErr = err;
      if (attempt < maxRetries - 1) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  throw wrapUpstreamError(lastErr);
}
