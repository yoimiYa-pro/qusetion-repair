import type { Area } from "react-easy-crop";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = src;
  });
}

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

export async function getCroppedImageBlob(
  imageSrc: string,
  cropPixels: Area,
  sourceMime: string
): Promise<{ blob: Blob; mime: string; ext: string }> {
  const image = await loadImage(imageSrc);
  const w = Math.max(1, Math.round(cropPixels.width));
  const h = Math.max(1, Math.round(cropPixels.height));
  const sx = Math.max(0, Math.round(cropPixels.x));
  const sy = Math.max(0, Math.round(cropPixels.y));

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
