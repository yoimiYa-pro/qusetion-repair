/** 后端 `ingest` 接受的类型；其余（如 HEIC）需在浏览器侧先转成 JPEG */
const SERVER_IMAGE_MIME = /^image\/(jpe?g|png|webp|gif)$/i;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法解码此图片（若为 iPhone 原图，请尝试裁切或导出为 JPG）"));
    img.src = src;
  });
}

export function needsClientReencodeToJpeg(f: File): boolean {
  if (SERVER_IMAGE_MIME.test(f.type)) return false;
  const n = f.name.toLowerCase();
  if (/\.(heic|heif)$/i.test(n)) return true;
  if (/^image\/(heic|heif)$/i.test(f.type)) return true;
  return false;
}

/**
 * 将 HEIC/HEIF 等转为 JPEG，便于画布裁切与后端上传。
 * 在支持解码的环境下（多数 iPhone Safari）整图绘制到 canvas 再导出。
 */
export async function reencodeToJpegIfNeeded(file: File): Promise<File> {
  if (!needsClientReencodeToJpeg(file)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = Math.max(1, img.naturalWidth || img.width);
    const h = Math.max(1, img.naturalHeight || img.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.88)
    );
    if (!blob) throw new Error("导出 JPEG 失败");
    const base = file.name.replace(/\.[^.]+$/i, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
