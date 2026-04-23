export type LlmProviderId = "moonshot" | "openai" | "gemini" | "mimo";

/** 前端 datalist / 文档用：实际请求仍可用任意模型 ID 字符串覆盖 */
export const LLM_MODEL_PRESETS: Record<LlmProviderId, readonly string[]> = {
  moonshot: ["kimi-k2.5"],
  gemini: ["gemini-3.1-flash-lite-preview", "gemini-3-flash-preview"],
  openai: ["gpt-4o-mini", "gpt-4o"],
  mimo: [
    "mimo-v2.5",
    "mimo-v2.5-pro",
    "mimo-v2-omni",
    "mimo-v2-flash",
    "mimo-v2-pro",
  ],
};

export interface ResolvedLlmEnv {
  provider: LlmProviderId;
  apiKey: string;
  /** OpenAI SDK：省略则使用官方默认域 */
  baseURL?: string;
  model: string;
}

export type ResolveLlmResult = ResolvedLlmEnv | { ok: false; message: string };

const MOONSHOT_DEFAULT_BASE = "https://api.moonshot.cn/v1";
const MOONSHOT_DEFAULT_MODEL = "kimi-k2.5";

/** Gemini 使用 OpenAI 兼容接口，见 https://ai.google.dev/gemini-api/docs/openai */
const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

/** 小米 MiMo OpenAI 兼容接口，见 https://platform.xiaomimimo.com/ */
const MIMO_DEFAULT_BASE = "https://api.xiaomimimo.com/v1";
const MIMO_DEFAULT_MODEL = "mimo-v2.5";

function pickMoonshot(): ResolveLlmResult {
  const moonshotKey = process.env.MOONSHOT_API_KEY?.trim();
  if (!moonshotKey) {
    return { ok: false, message: "已选择 Moonshot，但未配置 MOONSHOT_API_KEY" };
  }
  return {
    provider: "moonshot",
    apiKey: moonshotKey,
    baseURL: process.env.MOONSHOT_BASE_URL?.trim() || MOONSHOT_DEFAULT_BASE,
    model:
      process.env.MOONSHOT_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      MOONSHOT_DEFAULT_MODEL,
  };
}

function pickOpenai(): ResolveLlmResult {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) {
    return { ok: false, message: "已选择 OpenAI，但未配置 OPENAI_API_KEY" };
  }
  const base = process.env.OPENAI_BASE_URL?.trim();
  return {
    provider: "openai",
    apiKey: openaiKey,
    baseURL: base || undefined,
    model:
      process.env.OPENAI_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      "gpt-4o-mini",
  };
}

function pickGemini(): ResolveLlmResult {
  const geminiKey =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!geminiKey) {
    return {
      ok: false,
      message: "已选择 Google Gemini，但未配置 GEMINI_API_KEY（或 GOOGLE_API_KEY）",
    };
  }
  return {
    provider: "gemini",
    apiKey: geminiKey,
    baseURL: process.env.GEMINI_BASE_URL?.trim() || GEMINI_DEFAULT_BASE,
    model:
      process.env.GEMINI_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      GEMINI_DEFAULT_MODEL,
  };
}

function pickMimo(): ResolveLlmResult {
  const mimoKey =
    process.env.MIMO_API_KEY?.trim() || process.env.XIAOMI_API_KEY?.trim();
  if (!mimoKey) {
    return {
      ok: false,
      message: "已选择小米 MiMo，但未配置 MIMO_API_KEY（或 XIAOMI_API_KEY）",
    };
  }
  return {
    provider: "mimo",
    apiKey: mimoKey,
    baseURL: process.env.MIMO_BASE_URL?.trim() || MIMO_DEFAULT_BASE,
    model:
      process.env.MIMO_MODEL?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      MIMO_DEFAULT_MODEL,
  };
}

/**
 * 解析大模型环境变量（无请求级覆盖时使用）。
 * - `LLM_PROVIDER=moonshot|openai|gemini|mimo` 强制对应提供商（需有 Key）。
 * - 否则按顺序：Moonshot Key → Gemini Key → MiMo Key → OpenAI Key。
 */
export function resolveLlmFromEnv(): ResolveLlmResult {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const moonshotKey = process.env.MOONSHOT_API_KEY?.trim();
  const geminiKey =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const mimoKey =
    process.env.MIMO_API_KEY?.trim() || process.env.XIAOMI_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (explicit === "moonshot") return pickMoonshot();
  if (explicit === "openai") return pickOpenai();
  if (explicit === "gemini") return pickGemini();
  if (explicit === "mimo") return pickMimo();

  if (moonshotKey) return pickMoonshot();
  if (geminiKey) return pickGemini();
  if (mimoKey) return pickMimo();
  if (openaiKey) return pickOpenai();

  return {
    ok: false,
    message:
      "请配置 MOONSHOT_API_KEY、GEMINI_API_KEY（或 GOOGLE_API_KEY）、MIMO_API_KEY（或 XIAOMI_API_KEY）或 OPENAI_API_KEY；也可用 LLM_PROVIDER 指定提供商",
  };
}

/**
 * 单次任务解析：可覆盖服务商与模型名。
 * @param providerOverride `auto` | 空 → 走环境默认；否则 `moonshot` | `openai` | `gemini` | `mimo`
 * @param modelOverride 非空时覆盖该服务商的默认模型 ID
 */
export function resolveLlmForRequest(
  providerOverride?: string | null,
  modelOverride?: string | null
): ResolveLlmResult {
  const o = (providerOverride ?? "").trim().toLowerCase();
  let base: ResolveLlmResult;
  if (!o || o === "auto") {
    base = resolveLlmFromEnv();
  } else if (o === "moonshot") {
    base = pickMoonshot();
  } else if (o === "openai") {
    base = pickOpenai();
  } else if (o === "gemini") {
    base = pickGemini();
  } else if (o === "mimo") {
    base = pickMimo();
  } else {
    return {
      ok: false,
      message: `llm_provider 无效：${o}（允许 auto / moonshot / openai / gemini / mimo）`,
    };
  }
  if (!isResolvedLlmEnv(base)) return base;
  const mo = modelOverride?.trim();
  if (mo) return { ...base, model: mo };
  return base;
}

export function isResolvedLlmEnv(r: ResolveLlmResult): r is ResolvedLlmEnv {
  return !("ok" in r && r.ok === false);
}

/** 供前端展示哪些入口已配置（不返回密钥） */
export function getLlmOptionAvailability(): {
  moonshot: boolean;
  gemini: boolean;
  mimo: boolean;
  openai: boolean;
} {
  return {
    moonshot: Boolean(process.env.MOONSHOT_API_KEY?.trim()),
    gemini: Boolean(
      process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
    ),
    mimo: Boolean(
      process.env.MIMO_API_KEY?.trim() || process.env.XIAOMI_API_KEY?.trim()
    ),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

export function getLlmModelPresets(): {
  moonshot: string[];
  gemini: string[];
  mimo: string[];
  openai: string[];
} {
  return {
    moonshot: [...LLM_MODEL_PRESETS.moonshot],
    gemini: [...LLM_MODEL_PRESETS.gemini],
    mimo: [...LLM_MODEL_PRESETS.mimo],
    openai: [...LLM_MODEL_PRESETS.openai],
  };
}
