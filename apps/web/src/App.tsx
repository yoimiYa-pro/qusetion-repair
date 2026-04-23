import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageCropDialog } from "./ImageCropDialog";
import { reencodeToJpegIfNeeded } from "./imageNormalize";

/** 含 iPhone 相机常见的 HEIC/HEIF；部分机型 MIME 为空仅靠扩展名 */
const IMAGE_MIME = /^image\/(jpe?g|png|webp|gif|heic|heif)$/i;

function isImageFile(f: File): boolean {
  const n = f.name.toLowerCase();
  if (IMAGE_MIME.test(f.type)) return true;
  if (/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(n)) return true;
  if (!f.type && /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(n)) return true;
  if (f.type === "application/octet-stream" && /\.(jpe?g|png|heic|heif)$/i.test(n)) return true;
  return false;
}

function isDocumentFile(f: File): boolean {
  const n = f.name.toLowerCase();
  return (
    n.endsWith(".pdf") ||
    n.endsWith(".docx") ||
    f.type === "application/pdf" ||
    f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function filterForKind(files: File[], k: "image" | "document"): File[] {
  if (k === "image") return files.filter(isImageFile).slice(0, 10);
  const docs = files.filter(isDocumentFile);
  return docs.length ? [docs[0]] : [];
}

function mergeImageFiles(prev: File[], more: File[]): File[] {
  const map = new Map<string, File>();
  for (const f of [...prev, ...more.filter(isImageFile)]) {
    map.set(`${f.name}-${f.size}`, f);
  }
  return Array.from(map.values()).slice(0, 10);
}

function fileDedupeKey(f: File): string {
  return `${f.name}-${f.size}`;
}

type ImageCropSession = {
  mode: "replace" | "append";
  baseFiles: File[];
  croppedNew: File[];
};

type IngestKind = "image" | "text" | "document";

type OutputTier = "basic" | "advanced";

type LlmProviderChoice = "auto" | "moonshot" | "gemini" | "mimo" | "openai";

type JobStatus = "pending" | "processing" | "done" | "failed";

interface LlmProvidersAvailability {
  moonshot: boolean;
  gemini: boolean;
  /** 旧版 /llm/options 可能缺省，视为未配置 */
  mimo?: boolean;
  openai: boolean;
}

interface JobResponse {
  id: string;
  /** 人类可读编号；接口路径可用 /jobs/12 代替 UUID */
  seq?: number;
  status: JobStatus;
  kind: IngestKind;
  tier: OutputTier;
  llmProvider?: "moonshot" | "openai" | "gemini" | "mimo";
  llmModel?: string;
  createdAt: string;
  error?: string;
  errorCode?: string;
  downloadReady?: boolean;
}

function jobApiSegment(job: Pick<JobResponse, "seq" | "id">): string {
  return job.seq != null && Number.isFinite(job.seq) ? String(job.seq) : job.id;
}

interface JobListPayload {
  items: JobResponse[];
  total: number;
  limit: number;
  offset: number;
}

const LLM_SERVICE_LABEL: Record<string, string> = {
  moonshot: "Moonshot（Kimi）",
  gemini: "Google Gemini",
  mimo: "小米 MiMo",
  openai: "OpenAI",
};

function JobMetaGrid({ job }: { job: JobResponse }): JSX.Element {
  return (
    <dl className="meta-grid">
      <dt>编号</dt>
      <dd>{job.seq != null ? `#${job.seq}` : "—"}</dd>
      <dt>内部 ID</dt>
      <dd>
        <code className="mono-ellipsis" title={job.id}>
          {job.id.slice(0, 8)}…
        </code>
      </dd>
      <dt>类型</dt>
      <dd>{job.kind}</dd>
      <dt>层级</dt>
      <dd>{job.tier === "basic" ? "基础" : "进阶"}</dd>
      <dt>状态</dt>
      <dd>
        <span className={`history-status history-status--${job.status}`}>{job.status}</span>
      </dd>
      {job.llmProvider ? (
        <>
          <dt>推理</dt>
          <dd>{LLM_SERVICE_LABEL[job.llmProvider] ?? job.llmProvider}</dd>
          <dt>模型</dt>
          <dd className="meta-mono">{job.llmModel ?? "—"}</dd>
        </>
      ) : null}
    </dl>
  );
}

interface LlmModelPresets {
  moonshot: string[];
  gemini: string[];
  /** 旧版 /llm/options 可能缺省，按空数组处理 */
  mimo?: string[];
  openai: string[];
}

/** 与 `apps/server/src/llmConfig.ts` 中 `LLM_MODEL_PRESETS` 保持同步（API 未就绪时的下拉回退） */
const STATIC_LLM_MODEL_PRESETS: Required<LlmModelPresets> = {
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

function mergeLlmModelPresetsFromApi(api: LlmModelPresets | null): Required<LlmModelPresets> {
  const fb = STATIC_LLM_MODEL_PRESETS;
  if (!api) return { ...fb };
  const mimoApi = api.mimo ?? [];
  return {
    moonshot: api.moonshot.length ? [...api.moonshot] : [...fb.moonshot],
    gemini: api.gemini.length ? [...api.gemini] : [...fb.gemini],
    mimo: mimoApi.length ? [...mimoApi] : [...fb.mimo],
    openai: api.openai.length ? [...api.openai] : [...fb.openai],
  };
}

const MODEL_OPTGROUP_ORDER: { key: keyof Required<LlmModelPresets>; label: string }[] = [
  { key: "moonshot", label: "Moonshot（Kimi）" },
  { key: "gemini", label: "Google Gemini" },
  { key: "mimo", label: "小米 MiMo" },
  { key: "openai", label: "OpenAI" },
];

function modelPresetsForProvider(
  p: LlmProviderChoice,
  presets: LlmModelPresets | null
): string[] {
  if (!presets) return [];
  const mimo = presets.mimo ?? [];
  switch (p) {
    case "moonshot":
      return presets.moonshot;
    case "gemini":
      return presets.gemini;
    case "mimo":
      return mimo;
    case "openai":
      return presets.openai;
    default:
      return [...presets.moonshot, ...presets.gemini, ...mimo, ...presets.openai];
  }
}

/**
 * API 根路径。
 * - 未设置 `VITE_API_BASE` 时：与 Vite `base` 一致（根路径为 `/api`，子路径为 `/前缀/api`）。
 * - 子路径生产构建：构建前设置 `VITE_BASE_PATH=/前缀/`；勿再写死 `/api`。
 * - 完全独立域名/端口的后端：构建前设置 `VITE_API_BASE` 为完整根 URL（可含路径）。
 */
const apiBase = ((): string => {
  const explicit = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const b = import.meta.env.BASE_URL;
  const prefix = b.endsWith("/") ? b : `${b}/`;
  return `${prefix}api`.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/api";
})();

/** 模型预设 <select>：表示当前模型 ID 来自输入框且不在预设列表中 */
const LLM_MODEL_PRESET_OTHER = "__preset_other__";

function formatNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const isNetwork =
    msg === "Failed to fetch" ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed") ||
    (err instanceof TypeError && msg.toLowerCase().includes("fetch"));
  if (isNetwork) {
    return [
      "无法连接后端（请求未到达 API，与模型 API Key 无关）。",
      `本页使用的 API 根路径为「${apiBase}」（相对当前站点同源；子路径部署时应为 /前缀/api）。`,
      "【本地】已运行 npm run dev（或同时起 server + web）；浏览器用 http://localhost:5173 等 Vite 地址，勿用 file://；改过 apps/server/.env 的 PORT 时，前端终端应出现 [vite] /api -> 对应端口，否则设置环境变量 VITE_API_PROXY。",
      "【服务器】Nginx 是否已配置 location /api/（或子路径下的 /xxx/api/）并反代到本机 Node；pm2/node 是否在跑且端口与反代一致；云安全组/防火墙是否放行。前后端不同源时，构建前端前设置 VITE_API_BASE 为完整 API 根地址（如 https://api.example.com）。",
    ].join("");
  }
  return msg;
}

function isLikelyConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    msg === "Failed to fetch" ||
    msg.includes("NetworkError") ||
    msg.includes("Load failed") ||
    msg.includes("ECONNREFUSED") ||
    lower.includes("fetch") ||
    lower.includes("无法连接后端")
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* 非 HTTPS 或权限受限时降级 */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("execCommand copy failed");
  } finally {
    document.body.removeChild(ta);
  }
}

async function pollJob(id: string, onUpdate: (j: JobResponse) => void): Promise<JobResponse> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const res = await fetch(`${apiBase}/jobs/${id}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { error?: string }).error ?? `查询失败: ${res.status}`);
    }
    const job = (await res.json()) as JobResponse;
    onUpdate(job);
    if (job.status === "done" || job.status === "failed") return job;
    if (Date.now() > deadline) throw new Error("等待超时，请稍后在任务列表中手动刷新（当前为单页演示）。");
    await new Promise((r) => setTimeout(r, 1200));
  }
}

export function App(): JSX.Element {
  const [kind, setKind] = useState<IngestKind>("text");
  const [tier, setTier] = useState<OutputTier>("advanced");
  const [llmProviderSelect, setLlmProviderSelect] = useState<LlmProviderChoice>("auto");
  const [llmModelOverride, setLlmModelOverride] = useState("");
  const [llmAvail, setLlmAvail] = useState<LlmProvidersAvailability | null>(null);
  const [llmModelPresets, setLlmModelPresets] = useState<LlmModelPresets | null>(null);
  const [text, setText] = useState("");
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  /** 多图裁切队列；队首在 `ImageCropDialog` 中展示 */
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  /** 从已选列表点「裁切」替换该文件时非 null */
  const [reEditKey, setReEditKey] = useState<string | null>(null);
  const cropSessionRef = useRef<ImageCropSession | null>(null);
  /** 默认开启：避免「桌面版网站」宽视口下拍照不进入裁切；不需要时在界面取消勾选 */
  const [cropBeforeUpload, setCropBeforeUpload] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>("");
  const [copyTip, setCopyTip] = useState<string>("");
  /** 轮询中断时保留任务 id，用于「继续等待」重试 */
  const [stalledJobId, setStalledJobId] = useState<string | null>(null);
  /** 历史表格是否显示全部（默认仅显示最近 5 条） */
  const [showAllHistoryRows, setShowAllHistoryRows] = useState(false);

  const activeFlowRef = useRef<HTMLElement | null>(null);

  const cropDialogOpen = cropQueue.length > 0;

  /** 裁切全屏时锁定背后滚动（含 iOS），避免底层页面与拖选区手势抢触控 */
  useEffect(() => {
    if (!cropDialogOpen) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    html.classList.add("crop-dialog-open");
    body.classList.add("crop-dialog-open");
    Object.assign(body.style, {
      position: "fixed",
      top: `-${scrollY}px`,
      left: "0",
      right: "0",
      width: "100%",
    });
    return () => {
      html.classList.remove("crop-dialog-open");
      body.classList.remove("crop-dialog-open");
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      window.scrollTo(0, scrollY);
    };
  }, [cropDialogOpen]);

  const finalizeCropSession = useCallback(() => {
    const s = cropSessionRef.current;
    if (!s) return;
    cropSessionRef.current = null;
    if (s.mode === "replace") {
      setPickedFiles(mergeImageFiles([], s.croppedNew));
    } else {
      setPickedFiles(mergeImageFiles(s.baseFiles, s.croppedNew));
    }
  }, []);

  const pushCropOutput = useCallback(
    (f: File) => {
      const s = cropSessionRef.current;
      if (!s) return;
      s.croppedNew.push(f);
      setCropQueue((q) => {
        const rest = q.slice(1);
        if (rest.length === 0) finalizeCropSession();
        return rest;
      });
    },
    [finalizeCropSession]
  );

  const abortCropQueue = useCallback(() => {
    cropSessionRef.current = null;
    setReEditKey(null);
    setCropQueue([]);
  }, []);

  const clearPickedFiles = useCallback(() => {
    setPickedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, []);

  const applyPickedImages = useCallback(
    (imgs: File[], mode: "replace" | "append") => {
      if (!imgs.length) return;
      if (cropBeforeUpload) {
        cropSessionRef.current =
          mode === "replace"
            ? { mode: "replace", baseFiles: [], croppedNew: [] }
            : { mode: "append", baseFiles: [...pickedFiles], croppedNew: [] };
        setCropQueue(imgs);
      } else {
        void (async () => {
          const normalized = await Promise.all(imgs.map(reencodeToJpegIfNeeded));
          if (mode === "replace") setPickedFiles(normalized);
          else setPickedFiles((prev) => mergeImageFiles(prev, normalized));
        })();
      }
    },
    [cropBeforeUpload, pickedFiles]
  );

  const fileHint = useMemo(() => {
    if (kind === "image")
      return "支持多张 JPEG/PNG/WebP/GIF/HEIC（iPhone 相机），单张 ≤ 20MB。建议开启「上传前裁切」；小屏可使用「拍照（相机）」直接唤起镜头。";
    if (kind === "document") return "上传单个 PDF 或 DOCX（≤ 20MB）。可拖拽到下方区域或点击选择。";
    return "直接粘贴错题文字即可。";
  }, [kind]);

  useEffect(() => {
    setPickedFiles([]);
    dragDepth.current = 0;
    setIsDragging(false);
    cropSessionRef.current = null;
    setCropQueue([]);
    setReEditKey(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/llm/options`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          providers: LlmProvidersAvailability;
          modelPresets?: LlmModelPresets;
        };
        if (!cancelled) {
          setLlmAvail(data.providers);
          if (data.modelPresets) setLlmModelPresets(data.modelPresets);
        }
      } catch {
        /* 忽略：无后端时仅不显示可用性 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  /** 切换推理服务时清空模型覆盖，避免把 A 服务商的模型名带到 B 上 */
  useEffect(() => {
    setLlmModelOverride("");
  }, [llmProviderSelect]);

  const mergedLlmModelPresets = useMemo(() => mergeLlmModelPresetsFromApi(llmModelPresets), [llmModelPresets]);

  const presetModels = useMemo(() => {
    const raw = modelPresetsForProvider(llmProviderSelect, mergedLlmModelPresets);
    return [...new Set(raw)];
  }, [llmProviderSelect, mergedLlmModelPresets]);

  const modelPlaceholder = useMemo(() => {
    switch (llmProviderSelect) {
      case "moonshot":
        return "默认 kimi-k2.5";
      case "gemini":
        return "默认 gemini-3.1-flash-lite-preview";
      case "mimo":
        return "默认 mimo-v2.5";
      case "openai":
        return "默认 gpt-4o-mini";
      default:
        return "留空使用各服务环境变量中的默认模型";
    }
  }, [llmProviderSelect]);

  const modelPresetSelectValue = useMemo(() => {
    const t = llmModelOverride.trim();
    if (t === "") return "";
    if (presetModels.includes(t)) return t;
    return LLM_MODEL_PRESET_OTHER;
  }, [llmModelOverride, presetModels]);

  /** 仅在选择「其它 / 自定义」或与预设不一致时显示输入框，避免与下拉重复同一行文案 */
  const showLlmModelCustomInput = modelPresetSelectValue === LLM_MODEL_PRESET_OTHER;

  const customModelInputPlaceholder = useMemo(
    () => `输入未列入上拉的完整模型 ID（${modelPlaceholder}）`,
    [modelPlaceholder]
  );

  const cropDialogIndexLabel = useMemo(() => {
    if (reEditKey) return "（替换当前文件）";
    if (cropQueue.length === 0) return "";
    const s = cropSessionRef.current;
    const done = s?.croppedNew.length ?? 0;
    const total = done + cropQueue.length;
    return `（第 ${done + 1} / ${total} 张）`;
  }, [cropQueue.length, reEditKey]);

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list?.length) {
        setPickedFiles([]);
        return;
      }
      const arr = Array.from(list);
      if (kind === "image") {
        applyPickedImages(filterForKind(arr, "image"), "replace");
      } else {
        setPickedFiles(filterForKind(arr, "document"));
      }
    },
    [kind, applyPickedImages]
  );

  const onCameraInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list?.length || kind !== "image") return;
      applyPickedImages(filterForKind(Array.from(list), "image"), "append");
      e.target.value = "";
    },
    [kind, applyPickedImages]
  );

  const onDropFiles = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setIsDragging(false);
      if (cropQueue.length > 0) return;
      const incoming = Array.from(e.dataTransfer.files ?? []);
      if (!incoming.length) return;
      if (kind === "image") {
        const imgs = filterForKind(incoming, "image");
        if (!imgs.length) return;
        applyPickedImages(imgs, "append");
      } else {
        const next = filterForKind(incoming, "document");
        if (next.length) setPickedFiles(next);
      }
    },
    [kind, applyPickedImages, cropQueue.length]
  );

  const onDragEnterZone = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setIsDragging(true);
  }, []);

  const onDragLeaveZone = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDragOverZone = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const loadPreview = useCallback(async (id: string) => {
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewMarkdown(null);
    try {
      const res = await fetch(`${apiBase}/jobs/${id}/preview`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `加载预览失败: ${res.status}`);
      }
      const data = (await res.json()) as { markdown: string };
      setPreviewMarkdown(data.markdown);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }, [apiBase]);

  const copyPreview = useCallback(async () => {
    if (!previewMarkdown) return;
    try {
      await copyTextToClipboard(previewMarkdown);
      setCopyTip("已复制到剪贴板");
      window.setTimeout(() => setCopyTip(""), 2500);
    } catch (e) {
      setCopyTip(e instanceof Error ? e.message : "复制失败，请手动全选复制");
      window.setTimeout(() => setCopyTip(""), 3500);
    }
  }, [previewMarkdown]);

  const clearCurrentView = useCallback(() => {
    setJob(null);
    setMessage("");
    setPreviewMarkdown(null);
    setPreviewError("");
    setCopyTip("");
    setStalledJobId(null);
    setPreviewLoading(false);
  }, []);

  const scrollToActiveFlow = useCallback(() => {
    window.requestAnimationFrame(() => {
      activeFlowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const [history, setHistory] = useState<JobListPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const isRunPhase = useMemo(
    () => busy || (job != null && (job.status === "pending" || job.status === "processing")),
    [busy, job]
  );

  const historyVisibleRows = useMemo(() => {
    if (!history?.items.length) return [];
    if (showAllHistoryRows || history.items.length <= 5) return history.items;
    return history.items.slice(0, 5);
  }, [history, showAllHistoryRows]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const res = await fetch(`${apiBase}/jobs?limit=50&offset=0`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `加载历史失败: ${res.status}`);
      }
      const data = (await res.json()) as JobListPayload;
      setHistory(data);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const openJobFromHistory = useCallback(
    async (h: JobResponse) => {
      const segment = jobApiSegment(h);
      setStalledJobId(null);
      setMessage("");
      setPreviewError("");
      setCopyTip("");
      try {
        const res = await fetch(`${apiBase}/jobs/${segment}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? `加载任务失败: ${res.status}`);
        }
        const j = (await res.json()) as JobResponse;
        setJob(j);
        if (j.status === "done") {
          await loadPreview(segment);
          setMessage(
            `已载入任务 #${j.seq ?? "?"}` +
              (j.seq != null ? `（UUID 后缀 ${j.id.slice(0, 8)}…）` : `（${j.id.slice(0, 8)}…）`) +
              "，状态：完成"
          );
        } else if (j.status === "failed") {
          setPreviewMarkdown(null);
          setMessage(`已载入任务 #${j.seq ?? "?"}（失败）：${j.error ?? ""}（${j.errorCode ?? ""}）`);
        } else {
          setPreviewMarkdown(null);
          setMessage(`任务 #${j.seq ?? "?"} 状态：${j.status}，可稍后再点「刷新预览」或重新打开。`);
        }
        scrollToActiveFlow();
      } catch (e) {
        setMessage(formatNetworkError(e));
      }
    },
    [apiBase, loadPreview, scrollToActiveFlow]
  );

  const deleteHistoryJob = useCallback(
    async (h: JobResponse) => {
      const segment = jobApiSegment(h);
      try {
        const res = await fetch(`${apiBase}/jobs/${segment}`, { method: "DELETE" });
        if (res.status === 404) {
          setMessage("任务已不存在");
          await loadHistory();
        } else if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? `删除失败: ${res.status}`);
        }
        if (job?.id === h.id) {
          setJob(null);
          setPreviewMarkdown(null);
          setPreviewError("");
        }
        setMessage(h.seq != null ? `已删除任务 #${h.seq}` : `已删除任务 ${h.id.slice(0, 8)}…`);
        await loadHistory();
      } catch (e) {
        setMessage(formatNetworkError(e));
      }
    },
    [apiBase, job?.id, loadHistory]
  );

  const deleteAllHistory = useCallback(async () => {
    if (!window.confirm("确定删除全部历史记录？此操作不可恢复。")) return;
    try {
      const res = await fetch(`${apiBase}/jobs?all=1`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `清空失败: ${res.status}`);
      }
      const { deleted } = (await res.json()) as { deleted: number };
      setJob(null);
      setPreviewMarkdown(null);
      setPreviewError("");
      setMessage(`已清空历史，共删除 ${deleted} 条。`);
      await loadHistory();
    } catch (e) {
      setMessage(formatNetworkError(e));
    }
  }, [apiBase, loadHistory]);

  const retryPollFromStall = useCallback(async () => {
    if (!stalledJobId) return;
    const id = stalledJobId;
    setBusy(true);
    setMessage("");
    setStalledJobId(null);
    try {
      const final = await pollJob(id, setJob);
      if (final.status === "failed") {
        setMessage(`处理失败：${final.error ?? ""}（${final.errorCode ?? ""}）`);
      } else {
        setMessage("处理完成。下方可预览并复制，也可下载文件。");
        await loadPreview(id);
      }
      await loadHistory();
    } catch (e) {
      setMessage(formatNetworkError(e));
      setStalledJobId(id);
    } finally {
      setBusy(false);
    }
  }, [stalledJobId, loadPreview, loadHistory]);

  const onSubmit = useCallback(async () => {
    setBusy(true);
    setMessage("");
    setStalledJobId(null);
    setJob(null);
    setPreviewMarkdown(null);
    setPreviewError("");
    setCopyTip("");
    let created: JobResponse | null = null;
    try {
      const fd = new FormData();
      fd.append("kind", kind);
      fd.append("tier", tier);
      if (llmProviderSelect !== "auto") {
        fd.append("llm_provider", llmProviderSelect);
      }
      if (llmModelOverride.trim()) {
        fd.append("llm_model", llmModelOverride.trim());
      }
      if (kind === "text") {
        fd.append("content", text);
      }
      for (const f of pickedFiles) {
        fd.append("file", f, f.name);
      }

      const res = await fetch(`${apiBase}/jobs`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `创建任务失败: ${res.status}`);
      }
      created = (await res.json()) as JobResponse;
      setJob(created);
      setMessage(
        created.seq != null
          ? `任务已创建：编号 #${created.seq}（也可用纯数字 ${created.seq} 访问接口）`
          : `任务已创建：${created.id.slice(0, 8)}…`
      );
      scrollToActiveFlow();

      const final = await pollJob(created.id, setJob);
      if (final.status === "failed") {
        setMessage(`处理失败：${final.error ?? ""}（${final.errorCode ?? ""}）`);
      } else {
        setMessage("处理完成。下方可预览并复制，也可下载文件。");
        await loadPreview(created.id);
      }
      await loadHistory();
    } catch (e) {
      setMessage(formatNetworkError(e));
      if (created) setStalledJobId(created.id);
    } finally {
      setBusy(false);
    }
  }, [
    pickedFiles,
    kind,
    text,
    tier,
    llmProviderSelect,
    llmModelOverride,
    loadPreview,
    loadHistory,
    scrollToActiveFlow,
  ]);

  const download = useCallback(
    async (format: "md" | "zip") => {
      if (!job?.id) return;
      const res = await fetch(`${apiBase}/jobs/${jobApiSegment(job)}/download?format=${format}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage((err as { error?: string }).error ?? `下载失败: ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      const fallback = format === "zip" ? "mistakes.zip" : "mistakes.md";
      const filename = m?.[1] ?? fallback;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [apiBase, job]
  );

  const historyToolbar = (
    <div className="history-toolbar">
      <h2 className="history-title">历史记录</h2>
      <div className="history-actions">
        <button type="button" className="secondary" onClick={() => void loadHistory()} disabled={historyLoading}>
          {historyLoading ? "加载中…" : "刷新"}
        </button>
        <button
          type="button"
          className="secondary danger"
          onClick={() => void deleteAllHistory()}
          disabled={historyLoading || !history?.total}
        >
          清空全部
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`app-root shell${isRunPhase ? " shell--focus-run" : ""}${cropDialogOpen ? " shell--crop-open" : ""}`}
    >
      <header className="app-header">
        <div className="app-header-main">
          <h1>错题整理</h1>
          <p className="sub">本地工具流：图片 / 文本 / PDF·DOCX → Markdown（Obsidian 等）。</p>
        </div>
        <aside className="app-meta" aria-label="连接与状态">
          <span className="meta-k">API</span>
          <code className="api-pill">{apiBase}</code>
          {busy ? (
            <span className="busy-pill" aria-live="polite">
              运行中
            </span>
          ) : (
            <span className="idle-pill">就绪</span>
          )}
        </aside>
      </header>

      <div className="workbench">
        <div className={`workbench-col workbench-col--input${isRunPhase ? " workbench-col--muted" : ""}`}>
          <section className="panel panel--input" aria-labelledby="panel-input-h">
            <div className="panel-top">
              <h2 id="panel-input-h" className="panel-title">
                输入
              </h2>
            </div>
            <div className="panel-body">
              <span className="field-label" id="ingest-kind-label">
                类型
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="ingest-kind-label">
                {(
                  [
                    { v: "text" as const, label: "纯文本" },
                    { v: "image" as const, label: "图片" },
                    { v: "document" as const, label: "PDF / DOCX" },
                  ] as const
                ).map(({ v, label }) => (
                  <label key={v} className={`segmented-item${kind === v ? " is-active" : ""}`}>
                    <input
                      type="radio"
                      name="ingest-kind"
                      value={v}
                      checked={kind === v}
                      onChange={() => setKind(v)}
                      disabled={busy}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

        {kind === "text" ? (
          <>
            <label htmlFor="content">错题文本</label>
            <textarea
              id="content"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="粘贴题干、选项、你的错答等"
              disabled={busy}
            />
          </>
        ) : (
          <>
            <label className="label-text" htmlFor="file">
              文件
            </label>
            {kind === "image" ? (
              <label className="crop-toggle">
                <input
                  type="checkbox"
                  checked={cropBeforeUpload}
                  onChange={(e) => setCropBeforeUpload(e.target.checked)}
                  disabled={busy || cropQueue.length > 0}
                />
                <span>上传前裁切（手机上去边、放大题干；多图会逐张确认）</span>
              </label>
            ) : null}
            <div
              className={`drop-zone ${isDragging ? "drop-zone--active" : ""}`}
              onDragEnter={onDragEnterZone}
              onDragLeave={onDragLeaveZone}
              onDragOver={onDragOverZone}
              onDrop={onDropFiles}
            >
              <input
                ref={fileInputRef}
                id="file"
                className="drop-zone-input"
                type="file"
                multiple={kind === "image"}
                accept={
                  kind === "image"
                    ? "image/*"
                    : ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                }
                onChange={onFileInputChange}
                disabled={busy || cropQueue.length > 0}
              />
              <div className="drop-zone-inner" aria-hidden>
                <p className="drop-zone-title">拖拽文件到此处释放</p>
                <p className="drop-zone-sub">或点击此区域选择文件</p>
                {kind === "image" ? (
                  <p className="drop-zone-sub drop-zone-sub--mobile-hint">小屏可点下方「拍照」直接打开相机。</p>
                ) : null}
              </div>
            </div>
            {kind === "image" ? (
              <>
                {/*
                  iOS / 部分 WebView 对 display:none + JS .click() 调相机不稳定；
                  使用 label[for] 关联「视觉上隐藏但仍占位」的 input。
                */}
                <input
                  id="ingest-camera-input"
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="visually-hidden-file-input"
                  onChange={onCameraInputChange}
                  disabled={busy || cropQueue.length > 0}
                />
                <div
                  className={`mobile-capture-actions${busy || cropQueue.length > 0 ? " mobile-capture-actions--disabled" : ""}`}
                >
                  <label htmlFor="ingest-camera-input" className="secondary mobile-capture-label">
                    拍照（相机）
                  </label>
                  <label htmlFor="file" className="secondary mobile-capture-label">
                    相册 / 文件
                  </label>
                </div>
              </>
            ) : null}
            {pickedFiles.length > 0 ? (
              <ul className="picked-list">
                {pickedFiles.map((f) => (
                  <li key={fileDedupeKey(f)} className="picked-row">
                    <span className="picked-row-main">
                      {f.name}
                      <span className="picked-meta">（{(f.size / 1024).toFixed(1)} KB）</span>
                    </span>
                    {kind === "image" ? (
                      <button
                        type="button"
                        className="secondary picked-recrop"
                        onClick={() => {
                          setReEditKey(fileDedupeKey(f));
                          setCropQueue([f]);
                        }}
                        disabled={busy || cropQueue.length > 0}
                      >
                        裁切
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {pickedFiles.length > 0 ? (
              <button type="button" className="secondary linkish clear-picked-inline" onClick={clearPickedFiles} disabled={busy}>
                清空已选
              </button>
            ) : null}
          </>
        )}

        <details className="advanced-block">
          <summary className="advanced-summary">高级设置（推理服务、模型）</summary>
          <div className="advanced-body">
            <label htmlFor="llm-provider">推理服务</label>
            <select
              id="llm-provider"
              value={llmProviderSelect}
              onChange={(e) => setLlmProviderSelect(e.target.value as LlmProviderChoice)}
              disabled={busy}
            >
              <option value="auto">自动（环境变量优先级：Moonshot → Gemini → MiMo → OpenAI）</option>
              <option value="moonshot" disabled={llmAvail ? !llmAvail.moonshot : false}>
                Moonshot（Kimi）{llmAvail && !llmAvail.moonshot ? "（未配置 KEY）" : ""}
              </option>
              <option value="gemini" disabled={llmAvail ? !llmAvail.gemini : false}>
                Google Gemini{llmAvail && !llmAvail.gemini ? "（未配置 KEY）" : ""}
              </option>
              <option value="mimo" disabled={llmAvail != null && llmAvail.mimo === false}>
                小米 MiMo{llmAvail != null && llmAvail.mimo === false ? "（未配置 KEY）" : ""}
              </option>
              <option value="openai" disabled={llmAvail ? !llmAvail.openai : false}>
                OpenAI{llmAvail && !llmAvail.openai ? "（未配置 KEY）" : ""}
              </option>
            </select>

            <label htmlFor="llm-model-preset">模型（可选）</label>
            <select
              id="llm-model-preset"
              aria-label="选择默认、预设模型或自定义"
              className="model-preset-select"
              value={modelPresetSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") setLlmModelOverride("");
                else if (v === LLM_MODEL_PRESET_OTHER) {
                  setLlmModelOverride((prev) => {
                    const t = prev.trim();
                    if (presetModels.includes(t)) return "";
                    return prev;
                  });
                } else setLlmModelOverride(v);
              }}
              disabled={busy}
            >
              <option value="">使用默认（留空，走环境变量中的模型）</option>
              {llmProviderSelect === "auto" ? (
                MODEL_OPTGROUP_ORDER.map(({ key, label }) => {
                  const ids = mergedLlmModelPresets[key];
                  if (!ids.length) return null;
                  return (
                    <optgroup key={key} label={label}>
                      {ids.map((id) => (
                        <option key={`${key}:${id}`} value={id}>
                          {id}
                        </option>
                      ))}
                    </optgroup>
                  );
                })
              ) : (
                presetModels.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))
              )}
              <option value={LLM_MODEL_PRESET_OTHER}>其它模型 ID（展开下方输入框）</option>
            </select>
            {llmProviderSelect === "auto" && llmModelOverride.trim() !== "" && modelPresetSelectValue !== LLM_MODEL_PRESET_OTHER ? (
              <p className="hint model-auto-hint">
                当前为「自动」推理：所选模型 ID 会覆盖环境解析到的服务商上的默认模型名；若需与某一服务商列表严格对应，请先在上方固定推理服务。
              </p>
            ) : null}
            {showLlmModelCustomInput ? (
              <>
                <label htmlFor="llm-model" className="llm-model-custom-label">
                  自定义模型 ID
                </label>
                <input
                  id="llm-model"
                  className="model-override-input"
                  type="text"
                  value={llmModelOverride}
                  onChange={(e) => setLlmModelOverride(e.target.value)}
                  placeholder={customModelInputPlaceholder}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                />
              </>
            ) : null}
            <p className="hint">
              在 `apps/server/.env` 中配置对应 API Key；Gemini 使用 `GEMINI_API_KEY`；小米 MiMo 使用 `MIMO_API_KEY`（见{" "}
              <a href="https://platform.xiaomimimo.com/#/docs/tokenplan/quick-access" target="_blank" rel="noreferrer">
                快速接入
              </a>
              ）。
            </p>
          </div>
        </details>

        <fieldset className="tier-fieldset">
          <legend>输出层级</legend>
          <label className="tier-option">
            <input
              type="radio"
              name="output-tier"
              value="basic"
              checked={tier === "basic"}
              onChange={() => setTier("basic")}
              disabled={busy}
            />
            <span>
              <strong>基础</strong>：仅识别题干与选项；Markdown 只含这两部分，模型不做解析以节省 token。
            </span>
          </label>
          <label className="tier-option">
            <input
              type="radio"
              name="output-tier"
              value="advanced"
              checked={tier === "advanced"}
              onChange={() => setTier("advanced")}
              disabled={busy}
            />
            <span>
              <strong>进阶</strong>：完整笔记（作答、解析、知识点、公式等）。
            </span>
          </label>
        </fieldset>
            </div>
            <div className="panel-footer">
              <p className="hint panel-footer-hint">{fileHint}</p>
              <div className="panel-footer-actions">
                <button type="button" onClick={() => void onSubmit()} disabled={busy}>
                  {busy ? "处理中…" : "开始分析"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="workbench-col workbench-col--output">
          <section ref={activeFlowRef} id="active-flow" className="panel panel--run">
            <div className="panel-top panel-top--split">
              <h2 className="panel-title">运行与输出</h2>
              {job ? (
                <div className="panel-top-actions">
                  <span className={`status-chip history-status history-status--${job.status}`}>
                    {job.seq != null ? `#${job.seq}` : job.id.slice(0, 8)}
                  </span>
                  <button type="button" className="secondary btn-compact" onClick={clearCurrentView}>
                    清除上下文
                  </button>
                </div>
              ) : null}
            </div>
            <div className="panel-body panel-body--scroll">
              {!message && !job && !busy ? (
                <p className="hint panel-empty">提交左侧表单后，进度与 Markdown 预览会出现在此（与输入同屏，减少视线跳转）。</p>
              ) : null}

              {job ? <JobMetaGrid job={job} /> : null}

              {message ? (
                <div
                  className={`log-block${job?.status === "failed" ? " log-block--err" : job?.status === "done" ? " log-block--ok" : ""}`}
                >
                  {message.split("\n").map((line, i) => (
                    <p key={i} className="log-line">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}

              {job && (job.status === "pending" || job.status === "processing") ? (
                <p className="hint phase-hint">后台处理中，本列会自动更新；也可在下方历史表中重新打开同一编号。</p>
              ) : null}

              {stalledJobId ? (
                <div className="stall-actions">
                  <p className="hint stall-hint">连接曾中断，任务可能仍在后端执行，可继续等待轮询恢复。</p>
                  <div className="row">
                    <button type="button" onClick={() => void retryPollFromStall()} disabled={busy}>
                      {busy ? "等待中…" : "继续等待任务完成"}
                    </button>
                  </div>
                </div>
              ) : null}

              {message && message.includes("等待超时") ? (
                <div className="row">
                  <button type="button" className="secondary" onClick={() => void loadHistory()}>
                    刷新历史列表
                  </button>
                </div>
              ) : null}

              {message && isLikelyConnectionError(new Error(message)) ? (
                <div className="row">
                  <button type="button" className="secondary" onClick={() => void loadHistory()} disabled={historyLoading}>
                    {historyLoading ? "检测中…" : "重试加载历史"}
                  </button>
                </div>
              ) : null}

              {job?.status === "done" ? (
                <div className="row output-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void loadPreview(jobApiSegment(job))}
                    disabled={previewLoading}
                  >
                    {previewLoading ? "刷新预览…" : "刷新预览"}
                  </button>
                  <button type="button" className="secondary" onClick={() => void download("md")}>
                    下载 .md
                  </button>
                  <button type="button" className="secondary" onClick={() => void download("zip")}>
                    下载 .zip
                  </button>
                </div>
              ) : null}

              {job?.status === "done" && (previewLoading || previewMarkdown || previewError) ? (
                <div className="preview-embed">
                  <div className="preview-header">
                    <h3 className="preview-title">Markdown 预览</h3>
                    {previewMarkdown ? (
                      <button type="button" className="secondary btn-compact" onClick={() => void copyPreview()}>
                        复制全部
                      </button>
                    ) : null}
                  </div>
                  {copyTip ? <p className="copy-tip">{copyTip}</p> : null}
                  {previewError ? (
                    <>
                      <p className="error preview-error">{previewError}</p>
                      <div className="row">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void loadPreview(jobApiSegment(job))}
                          disabled={previewLoading}
                        >
                          {previewLoading ? "加载中…" : "重新加载预览"}
                        </button>
                      </div>
                    </>
                  ) : null}
                  {previewLoading && !previewMarkdown ? (
                    <>
                      <p className="hint">正在加载预览内容…</p>
                      <div className="preview-skeleton" aria-hidden />
                    </>
                  ) : null}
                  {previewMarkdown ? (
                    <pre className="preview-pre" tabIndex={0}>
                      {previewMarkdown}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>

      <section className="panel-host panel-host--history">
        {historyError ? (
          <div className="card card--recover">
            <p className="error">{historyError}</p>
            <button type="button" className="secondary" onClick={() => void loadHistory()} disabled={historyLoading}>
              {historyLoading ? "重试中…" : "重试加载历史"}
            </button>
          </div>
        ) : null}

        {!historyError && history === null && historyLoading ? (
          <div className="card card--history">
            {historyToolbar}
            <p className="hint">正在加载历史记录…</p>
          </div>
        ) : null}

        {!historyError && history && !historyLoading && history.total === 0 ? (
          <details className="card card--history card--history-collapsible">
            <summary className="history-collapsible-summary">历史记录（暂无）</summary>
            <div className="history-collapsible-body">
              {historyToolbar}
              <p className="hint">尚无任务，提交一次分析后会出现在展开区域。</p>
            </div>
          </details>
        ) : null}

        {!historyError && history && history.total > 0 ? (
          <div className="card card--history">
            {historyToolbar}
            <p className="hint history-meta">
              共 {history.total} 条，本页 {history.items.length} 条（最多展示最近 {history.limit} 条）。「编号」为固定好记的
              递增数字；接口路径可写 <code>/jobs/编号</code>，与 UUID 等价。
            </p>
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>编号</th>
                    <th>状态</th>
                    <th>类型</th>
                    <th>层级</th>
                    <th>内部 ID</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {historyVisibleRows.map((h) => (
                    <tr key={h.id}>
                      <td className="history-cell-muted">{new Date(h.createdAt).toLocaleString()}</td>
                      <td>
                        <strong className="history-seq">{h.seq != null ? `#${h.seq}` : "—"}</strong>
                      </td>
                      <td>
                        <span className={`history-status history-status--${h.status}`}>{h.status}</span>
                      </td>
                      <td>{h.kind}</td>
                      <td>{h.tier === "basic" ? "基础" : "进阶"}</td>
                      <td>
                        <code className="history-id" title={h.id}>
                          {h.id.slice(0, 8)}…
                        </code>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary linkish history-row-btn"
                          onClick={() => void openJobFromHistory(h)}
                        >
                          查看
                        </button>
                        <button
                          type="button"
                          className="secondary linkish history-row-btn danger"
                          onClick={() => void deleteHistoryJob(h)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {history.items.length > 5 ? (
              <div className="row history-expand-row">
                {!showAllHistoryRows ? (
                  <button type="button" className="secondary" onClick={() => setShowAllHistoryRows(true)}>
                    展开全部（共 {history.items.length} 条）
                  </button>
                ) : (
                  <button type="button" className="secondary" onClick={() => setShowAllHistoryRows(false)}>
                    收起，仅显示最近 5 条
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="mobile-submit-dock" aria-label="快捷操作">
        {(kind === "image" || kind === "document") && pickedFiles.length > 0 ? (
          <button
            type="button"
            className="mobile-submit-dock__btn mobile-submit-dock__btn--secondary"
            onClick={clearPickedFiles}
            disabled={busy || cropQueue.length > 0}
          >
            清空已选
          </button>
        ) : null}
        <button
          type="button"
          className="mobile-submit-dock__btn mobile-submit-dock__btn--primary"
          onClick={() => void onSubmit()}
          disabled={busy || cropQueue.length > 0}
        >
          {busy ? "处理中…" : "开始分析"}
        </button>
      </div>

      {cropQueue[0] ? (
        <ImageCropDialog
          file={cropQueue[0]}
          indexLabel={cropDialogIndexLabel}
          busy={busy}
          onConfirmCropped={(nf) => {
            if (reEditKey) {
              setPickedFiles((prev) => prev.map((x) => (fileDedupeKey(x) === reEditKey ? nf : x)));
              setReEditKey(null);
              setCropQueue([]);
              return;
            }
            pushCropOutput(nf);
          }}
          onUseOriginal={(of) => {
            if (reEditKey) {
              setReEditKey(null);
              setCropQueue([]);
              return;
            }
            pushCropOutput(of);
          }}
          onAbortQueue={abortCropQueue}
        />
      ) : null}
    </div>
  );
}
