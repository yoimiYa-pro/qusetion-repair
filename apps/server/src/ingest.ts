import mammoth from "mammoth";

export type IngestKind = "image" | "text" | "document";

export interface ImagePart {
  mime: string;
  base64: string;
  filename?: string;
}

export interface IngestResult {
  /** 已抽取的纯文本（题干/文档内容） */
  plainTextParts: string[];
  /** 图片，供多模态模型读取 */
  imageParts: ImagePart[];
}

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 120_000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

function truncateText(s: string): string {
  if (s.length <= MAX_TEXT_CHARS) return s;
  return `${s.slice(0, MAX_TEXT_CHARS)}\n\n[已截断，超出 ${MAX_TEXT_CHARS} 字符上限]`;
}

export function assertImageBuffer(filename: string, mime: string, buf: Buffer): void {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (!IMAGE_MIMES.has(m)) {
    throw Object.assign(new Error(`不支持的图片类型: ${mime}`), { code: "UNSUPPORTED_IMAGE" });
  }
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("图片过大"), { code: "FILE_TOO_LARGE" });
  }
  if (buf.byteLength === 0) {
    throw Object.assign(new Error("空文件"), { code: "EMPTY_FILE" });
  }
}

export function bufferToImagePart(
  filename: string,
  mime: string,
  buf: Buffer
): ImagePart {
  assertImageBuffer(filename, mime, buf);
  const m = mime.toLowerCase().split(";")[0].trim();
  return { mime: m, base64: buf.toString("base64"), filename };
}

export async function extractPdfText(buf: Buffer): Promise<string> {
  if (buf.byteLength > MAX_PDF_BYTES) {
    throw Object.assign(new Error("PDF 过大"), { code: "FILE_TOO_LARGE" });
  }
  const mod = await import("pdf-parse");
  const pdfParse = mod.default as (b: Buffer) => Promise<{ text: string }>;
  const { text } = await pdfParse(buf);
  return truncateText((text ?? "").trim());
}

export async function extractDocxText(buf: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return truncateText((value ?? "").trim());
}

export async function extractDocumentText(
  filename: string,
  buf: Buffer
): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const t = await extractPdfText(buf);
    if (!t) {
      throw Object.assign(
        new Error("PDF 未抽取到文本，可能是扫描版；后续版本可支持整页识别。"),
        { code: "PDF_NO_TEXT" }
      );
    }
    return t;
  }
  if (lower.endsWith(".docx")) {
    return await extractDocxText(buf);
  }
  throw Object.assign(new Error("仅支持 .pdf 或 .docx 文档"), { code: "UNSUPPORTED_DOCUMENT" });
}

export function normalizeTextInput(raw: string): IngestResult {
  const t = truncateText((raw ?? "").trim());
  if (!t) {
    throw Object.assign(new Error("文本内容为空"), { code: "EMPTY_TEXT" });
  }
  return { plainTextParts: [t], imageParts: [] };
}

export function mergeIngestParts(parts: IngestResult[]): IngestResult {
  const plainTextParts: string[] = [];
  const imageParts: ImagePart[] = [];
  for (const p of parts) {
    plainTextParts.push(...p.plainTextParts);
    imageParts.push(...p.imageParts);
  }
  if (!plainTextParts.length && !imageParts.length) {
    throw Object.assign(new Error("没有可分析的内容"), { code: "EMPTY_INPUT" });
  }
  return { plainTextParts, imageParts };
}
