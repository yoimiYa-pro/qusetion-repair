import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { JobRecord, JobStatus } from "./jobTypes.js";
import type { IngestKind } from "./ingest.js";
import type { LlmProviderId } from "./llmConfig.js";
import type { OutputTier } from "@qusetion-repair/core";

interface JobRow {
  id: string;
  seq: number | null;
  status: string;
  kind: string;
  tier: string;
  created_at: string;
  llm_provider: string | null;
  llm_model: string | null;
  error: string | null;
  error_code: string | null;
  markdown_filename: string | null;
  markdown: string | null;
}

function rowToRecord(r: JobRow): JobRecord {
  return {
    id: r.id,
    seq: r.seq ?? undefined,
    status: r.status as JobStatus,
    kind: r.kind as IngestKind,
    tier: r.tier as OutputTier,
    llmProvider: (r.llm_provider ?? undefined) as LlmProviderId | undefined,
    llmModel: r.llm_model ?? undefined,
    createdAt: r.created_at,
    error: r.error ?? undefined,
    errorCode: r.error_code ?? undefined,
    markdownFilename: r.markdown_filename ?? undefined,
  };
}

export class JobStore {
  private readonly db: Database.Database;

  constructor(dbFilePath: string) {
    mkdirSync(dirname(dbFilePath), { recursive: true });
    this.db = new Database(dbFilePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
    this.migrateSeqColumn();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        kind TEXT NOT NULL,
        tier TEXT NOT NULL,
        created_at TEXT NOT NULL,
        llm_provider TEXT,
        llm_model TEXT,
        error TEXT,
        error_code TEXT,
        markdown_filename TEXT,
        markdown TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs (status, created_at DESC);
    `);
  }

  /** 旧库补全自增编号，便于展示「#1」「#2」 */
  private migrateSeqColumn(): void {
    const cols = this.db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
    if (cols.some((c) => c.name === "seq")) return;
    this.db.exec(`ALTER TABLE jobs ADD COLUMN seq INTEGER`);
    const rows = this.db.prepare(`SELECT id FROM jobs ORDER BY created_at ASC, id ASC`).all() as { id: string }[];
    const upd = this.db.prepare(`UPDATE jobs SET seq = ? WHERE id = ?`);
    let n = 1;
    for (const r of rows) {
      upd.run(n++, r.id);
    }
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_seq ON jobs (seq)`);
  }

  insertPending(job: Pick<JobRecord, "id" | "kind" | "tier" | "createdAt">): void {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM jobs`).get() as { n: number };
      this.db
        .prepare(
          `INSERT INTO jobs (id, status, kind, tier, created_at, seq)
           VALUES (@id, 'pending', @kind, @tier, @created_at, @seq)`
        )
        .run({
          id: job.id,
          kind: job.kind,
          tier: job.tier,
          created_at: job.createdAt,
          seq: row.n,
        });
    });
    tx();
  }

  setProcessing(id: string, llmProvider: LlmProviderId, llmModel: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'processing', llm_provider = @p, llm_model = @m WHERE id = @id`
      )
      .run({ id, p: llmProvider, m: llmModel });
  }

  setDone(id: string, markdown: string, markdownFilename: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'done', markdown = @md, markdown_filename = @fn WHERE id = @id`
      )
      .run({ id, md: markdown, fn: markdownFilename });
  }

  setFailed(id: string, error: string, errorCode: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'failed', error = @e, error_code = @c WHERE id = @id`
      )
      .run({ id, e: error, c: errorCode });
  }

  getById(id: string): JobRecord | undefined {
    const r = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
    return r ? rowToRecord(r) : undefined;
  }

  getBySeq(seq: number): JobRecord | undefined {
    const r = this.db.prepare(`SELECT * FROM jobs WHERE seq = ?`).get(seq) as JobRow | undefined;
    return r ? rowToRecord(r) : undefined;
  }

  getMarkdown(id: string): string | null {
    const row = this.db
      .prepare(`SELECT markdown FROM jobs WHERE id = ? AND status = 'done'`)
      .get(id) as { markdown: string | null } | undefined;
    return row?.markdown ?? null;
  }

  /** 列表不含 markdown 正文，避免大结果集拖慢接口 */
  listSummaries(limit: number, offset: number): { items: JobRecord[]; total: number } {
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS c FROM jobs`).get() as { c: number };
    const rows = this.db
      .prepare(
        `SELECT id, seq, status, kind, tier, created_at, llm_provider, llm_model, error, error_code, markdown_filename
         FROM jobs ORDER BY datetime(created_at) DESC LIMIT @lim OFFSET @off`
      )
      .all({ lim: limit, off: offset }) as JobRow[];
    return { items: rows.map(rowToRecord), total: totalRow.c };
  }

  deleteById(id: string): boolean {
    const r = this.db.prepare(`DELETE FROM jobs WHERE id = ?`).run(id);
    return r.changes > 0;
  }

  /** @returns 删除的行数 */
  deleteAll(): number {
    const r = this.db.prepare(`DELETE FROM jobs`).run();
    return r.changes;
  }

  close(): void {
    this.db.close();
  }
}
