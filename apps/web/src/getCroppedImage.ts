/** 显示坐标系下的裁切框（与 `react-image-crop` 的 PixelCrop 一致，相对 img 的 client 尺寸） */
export type DisplayPixelCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 裁切后输出类型：GIF 导出为 PNG，其余 JPEG 仍 JPEG，PNG/WebP 保持 */
export function outputMimeForCrop(sourceMime: string): { mime: string; ext: string } {
  if (sourceMime === "image/png") return { mime: "image/png", ext: ".png" };
  if (sourceMime === "image/webp") return { mime: "image/webp", ext: ".webp" };
  if (sourceMime === "image/gif") return { mime: "image/png", ext: ".png" };
  return { mime: "image/jpeg", ext: ".jpg" };
}

export function croppedFileName(originalName: string, ext: string): string {
  const base = originalName.replace(/\.[^.]+$/, "");
  return `${base || "image"}-crop${ext}`;
}

/**
 * 按「显示尺寸上的选区」映射到原图像素后导出（支持自由长宽比拖角裁切）。
 */
export async function getCroppedImageBlobFromImageElement(
  image: HTMLImageElement,
  cropDisplay: DisplayPixelCrop,
  sourceMime: string
): Promise<{ blob: Blob; mime: string; ext: string }> {
  const dw = Math.max(1, image.naturalWidth / Math.max(1, image.width));
  const dh = Math.max(1, image.naturalHeight / Math.max(1, image.height));
  const sx = Math.max(0, Math.round(cropDisplay.x * dw));
  const sy = Math.max(0, Math.round(cropDisplay.y * dh));
  const w = Math.max(1, Math.round(cropDisplay.width * dw));
  const h = Math.max(1, Math.round(cropDisplay.height * dh));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  ctx.drawImage(image, sx, sy, w, h, 0, 0, w, h);

  const { mime, ext } = outputMimeForCrop(sourceMime);
  const quality = mime === "image/jpeg" ? 0.9 : undefined;
  const blob: Blob | null = await new Promise((res) =>
    canvas.toBlob((b) => res(b), mime, quality as number | undefined)
  );
  if (!blob) throw new Error("导出裁切图失败");
  return { blob, mime, ext };
}
