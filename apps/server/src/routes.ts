import type { OutputTier } from "@qusetion-repair/core";
import type { FastifyInstance } from "fastify";
import {
  createAndEnqueueJob,
  getJob,
  readJobMarkdown,
  zipMarkdown,
  type CreateJobInput,
} from "./jobs.js";
import type { JobStore } from "./jobStore.js";
import { getLlmModelPresets, getLlmOptionAvailability } from "./llmConfig.js";
import type { IngestKind } from "./ingest.js";

function isIngestKind(s: string): s is IngestKind {
  return s === "image" || s === "text" || s === "document";
}

function parseOutputTier(raw: string | undefined): OutputTier | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "" || t === "advanced") return "advanced";
  if (t === "basic") return "basic";
  return null;
}

export async function registerRoutes(app: FastifyInstance, jobStore: JobStore): Promise<void> {
  app.get("/health", async () => ({ ok: true }));

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/jobs", async (request, reply) => {
    const limRaw = Number(request.query.limit ?? 50);
    const offRaw = Number(request.query.offset ?? 0);
    const limit = Number.isFinite(limRaw) ? Math.min(200, Math.max(1, Math.floor(limRaw))) : 50;
    const offset = Number.isFinite(offRaw) ? Math.max(0, Math.floor(offRaw)) : 0;
    const { items, total } = jobStore.listSummaries(limit, offset);
    return reply.send({
      items: items.map((j) => ({
        id: j.id,
        seq: j.seq,
        status: j.status,
        kind: j.kind,
        tier: j.tier,
        llmProvider: j.llmProvider,
        llmModel: j.llmModel,
        createdAt: j.createdAt,
        error: j.error,
        errorCode: j.errorCode,
        downloadReady: j.status === "done",
      })),
      total,
      limit,
      offset,
    });
  });

  app.delete<{ Querystring: { all?: string } }>("/jobs", async (request, reply) => {
    const all = (request.query.all ?? "").trim().toLowerCase();
    if (all !== "1" && all !== "true" && all !== "yes") {
      return reply.code(400).send({ error: "清空全部需传查询参数 all=1（或 true/yes）" });
    }
    const deleted = jobStore.deleteAll();
    return reply.send({ deleted });
  });

  app.get("/llm/options", async () => {
    const a = getLlmOptionAvailability();
    return {
      providers: a,
      modelPresets: getLlmModelPresets(),
      hints: {
        moonshot: "需 MOONSHOT_API_KEY",
        gemini: "需 GEMINI_API_KEY（或 GOOGLE_API_KEY），OpenAI 兼容端点",
        mimo: "需 MIMO_API_KEY（或 XIAOMI_API_KEY），OpenAI 兼容端点（platform.xiaomimimo.com）",
        openai: "需 OPENAI_API_KEY",
      },
    };
  });

  app.post("/jobs", async (request, reply) => {
    const parts = request.parts();
    let kindRaw = "";
    let tierRaw = "";
    let llmProviderRaw = "";
    let llmModelRaw = "";
    let textContent = "";
    const files: CreateJobInput["files"] = [];

    for await (const part of parts) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        files.push({
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: buf,
        });
      } else if (part.fieldname === "kind") {
        kindRaw = String(part.value);
      } else if (part.fieldname === "tier") {
        tierRaw = String(part.value);
      } else if (part.fieldname === "llm_provider") {
        llmProviderRaw = String(part.value);
      } else if (part.fieldname === "llm_model") {
        llmModelRaw = String(part.value);
      } else if (part.fieldname === "content" || part.fieldname === "text") {
        textContent = String(part.value);
      }
    }

    if (!isIngestKind(kindRaw)) {
      return reply.code(400).send({ error: "kind 必须是 image | text | document" });
    }

    const tier = parseOutputTier(tierRaw);
    if (tier === null) {
      return reply.code(400).send({ error: "tier 必须是 basic（基础）或 advanced（进阶）" });
    }

    try {
      const job = createAndEnqueueJob(jobStore, {
        kind: kindRaw,
        tier,
        llmProvider: llmProviderRaw.trim() || undefined,
        llmModel: llmModelRaw.trim() || undefined,
        textContent,
        files,
      });
      return reply.code(202).send({
        id: job.id,
        seq: job.seq,
        status: job.status,
        kind: job.kind,
        tier: job.tier,
        createdAt: job.createdAt,
      });
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "BAD_REQUEST";
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(400).send({ error: msg, code });
    }
  });

  app.delete<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const job = getJob(jobStore, request.params.id);
    if (!job) return reply.code(404).send({ error: "任务不存在" });
    jobStore.deleteById(job.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", async (request, reply) => {
    const job = getJob(jobStore, request.params.id);
    if (!job) return reply.code(404).send({ error: "任务不存在" });
    return reply.send({
      id: job.id,
      seq: job.seq,
      status: job.status,
      kind: job.kind,
      tier: job.tier,
      llmProvider: job.llmProvider,
      llmModel: job.llmModel,
      createdAt: job.createdAt,
      error: job.error,
      errorCode: job.errorCode,
      downloadReady: job.status === "done",
    });
  });

  app.get<{ Params: { id: string } }>("/jobs/:id/preview", async (request, reply) => {
    const job = getJob(jobStore, request.params.id);
    if (!job) return reply.code(404).send({ error: "任务不存在" });
    if (job.status !== "done") {
      return reply.code(409).send({ error: "任务尚未完成", status: job.status });
    }
    try {
      const markdown = await readJobMarkdown(jobStore, job);
      return reply.send({ markdown });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    "/jobs/:id/download",
    async (request, reply) => {
      const job = getJob(jobStore, request.params.id);
      if (!job) return reply.code(404).send({ error: "任务不存在" });
      if (job.status !== "done") {
        return reply.code(409).send({ error: "任务尚未完成", status: job.status });
      }
      const fmt = (request.query.format ?? "md").toLowerCase();
      try {
        const md = await readJobMarkdown(jobStore, job);
        const baseName = job.markdownFilename ?? "mistakes.md";
        if (fmt === "zip") {
          const zipBuf = await zipMarkdown(md, baseName);
          return reply
            .header("content-type", "application/zip")
            .header("content-disposition", `attachment; filename="${baseName.replace(/\.md$/i, "")}.zip"`)
            .send(zipBuf);
        }
        return reply
          .header("content-type", "text/markdown; charset=utf-8")
          .header("content-disposition", `attachment; filename="${baseName}"`)
          .send(md);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.code(500).send({ error: msg });
      }
    }
  );
}
