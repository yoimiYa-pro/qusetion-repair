import { PassThrough } from "node:stream";
import { v4 as uuidv4 } from "uuid";
import archiver from "archiver";
import { renderMistakeBatchToMarkdown, type OutputTier } from "@qusetion-repair/core";
import { getJobByRouteParam } from "./jobLookup.js";
import type { JobStore } from "./jobStore.js";
import type { CreateJobInput, JobRecord } from "./jobTypes.js";
import type { IngestKind } from "./ingest.js";
import {
  bufferToImagePart,
  extractDocumentText,
  mergeIngestParts,
  normalizeTextInput,
  type IngestResult,
} from "./ingest.js";
import { analyzeIngestToBatch, LlmError } from "./llm.js";
import { isResolvedLlmEnv, resolveLlmForRequest } from "./llmConfig.js";

export type { CreateJobInput, JobRecord, JobStatus } from "./jobTypes.js";

export function zipMarkdown(markdown: string, filename: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    archive.on("error", reject);
    archive.pipe(stream);
    archive.append(markdown, { name: filename });
    void archive.finalize().catch(reject);
  });
}

export function createAndEnqueueJob(store: JobStore, input: CreateJobInput): JobRecord {
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const tier: OutputTier = input.tier ?? "advanced";
  const record: JobRecord = {
    id,
    status: "pending",
    kind: input.kind,
    tier,
    createdAt,
  };
  store.insertPending(record);
  void processJob(store, id, input);
  return store.getById(id) ?? record;
}

async function buildIngest(input: CreateJobInput): Promise<IngestResult> {
  const parts: IngestResult[] = [];
  if (input.kind === "text") {
    parts.push(normalizeTextInput(input.textContent ?? ""));
  } else if (input.kind === "image") {
    if (!input.files.length) {
      throw Object.assign(new Error("请至少上传一张图片"), { code: "NO_FILE" });
    }
    const imgs = input.files.map((f) => bufferToImagePart(f.filename, f.mimetype, f.buffer));
    parts.push({ plainTextParts: [], imageParts: imgs });
  } else {
    if (input.files.length !== 1) {
      throw Object.assign(new Error("文档模式请上传单个 PDF 或 DOCX"), { code: "INVALID_DOCUMENT" });
    }
    const f = input.files[0];
    const text = await extractDocumentText(f.filename, f.buffer);
    parts.push({ plainTextParts: [text], imageParts: [] });
  }
  return mergeIngestParts(parts);
}

function errorCodeFromUnknown(e: unknown): string {
  if (e instanceof LlmError) return e.code;
  if (e && typeof e === "object" && "code" in e && typeof (e as { code?: string }).code === "string") {
    return (e as { code: string }).code;
  }
  return "JOB_FAILED";
}

async function processJob(store: JobStore, id: string, input: CreateJobInput): Promise<void> {
  if (!store.getById(id)) return;
  try {
    const llm = resolveLlmForRequest(input.llmProvider, input.llmModel);
    if (!isResolvedLlmEnv(llm)) {
      throw Object.assign(new Error(llm.message), { code: "MISSING_API_KEY" });
    }
    store.setProcessing(id, llm.provider, llm.model);

    const ingest = await buildIngest(input);
    const tier = store.getById(id)?.tier ?? "advanced";
    const batch = await analyzeIngestToBatch(ingest, {
      apiKey: llm.apiKey,
      baseURL: llm.baseURL,
      model: llm.model,
      provider: llm.provider,
      tier,
    });
    const md = renderMistakeBatchToMarkdown(batch, {
      createdAt: new Date().toISOString().slice(0, 10),
      tier,
    });
    const filename = `mistakes-${id.slice(0, 8)}.md`;
    store.setDone(id, md, filename);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.setFailed(id, msg, errorCodeFromUnknown(e));
  }
}

export function getJob(store: JobStore, routeId: string): JobRecord | undefined {
  return getJobByRouteParam(store, routeId);
}

export async function readJobMarkdown(store: JobStore, job: JobRecord): Promise<string> {
  const md = store.getMarkdown(job.id);
  if (md == null || md === "") throw new Error("无可下载内容");
  return md;
}
