import { createRequire } from "node:module";
import type { ErrorObject, ValidateFunction } from "ajv";
import { mistakeBatchBasicSchema } from "./schema/mistake-batch-basic.schema.js";
import { mistakeBatchSchema } from "./schema/mistake-batch.schema.js";
import type { MistakeNoteBatch, OutputTier } from "./types.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as new (opts?: Record<string, unknown>) => {
  compile: <T = unknown>(schema: unknown) => ValidateFunction<T>;
};
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateAdvanced = ajv.compile<MistakeNoteBatch>(mistakeBatchSchema);
const validateBasicRaw = ajv.compile(mistakeBatchBasicSchema);

function asBatchFromBasicValidated(data: unknown): MistakeNoteBatch {
  const o = data as {
    items: Array<{ title: string; stem: string; topic_tags: string[]; options?: string[] }>;
    batch_title?: string;
  };
  return {
    batch_title: o.batch_title,
    items: o.items.map((i) => ({
      title: i.title,
      stem: i.stem,
      topic_tags: i.topic_tags,
      options: i.options,
    })),
  };
}

export function validateMistakeBatch(data: unknown): {
  ok: true;
  value: MistakeNoteBatch;
} | { ok: false; errors: ErrorObject[] | null | undefined } {
  if (validateAdvanced(data)) {
    return { ok: true, value: data };
  }
  return { ok: false, errors: validateAdvanced.errors };
}

export function validateMistakeBatchForTier(
  data: unknown,
  tier: OutputTier
): {
  ok: true;
  value: MistakeNoteBatch;
} | { ok: false; errors: ErrorObject[] | null | undefined } {
  if (tier === "basic") {
    if (validateBasicRaw(data)) {
      return { ok: true, value: asBatchFromBasicValidated(data) };
    }
    return { ok: false, errors: validateBasicRaw.errors };
  }
  return validateMistakeBatch(data);
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return "校验失败";
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim())
    .join("; ");
}
