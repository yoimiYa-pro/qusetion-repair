import { useCallback, useEffect, useId, useRef, useState } from "react";
import ReactCrop, { centerCrop, type Crop, type PercentCrop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { croppedFileName, getCroppedImageBlobFromImageElement } from "./getCroppedImage";
import { reencodeToJpegIfNeeded } from "./imageNormalize";

/** 以「四边留白 %」表示裁切区，便于滑块像移动参考线一样微调 */
type EdgeInsetPct = { top: number; right: number; bottom: number; left: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const MIN_CROP_PCT = 12;

function percentCropToInsets(c: PercentCrop): EdgeInsetPct {
  return {
    left: c.x,
    top: c.y,
    right: 100 - c.x - c.width,
    bottom: 100 - c.y - c.height,
  };
}

function clampInsets(e: EdgeInsetPct): EdgeInsetPct {
  let { top, right, bottom, left } = e;
  left = clamp(left, 0, 100 - MIN_CROP_PCT);
  right = clamp(right, 0, 100 - MIN_CROP_PCT);
  top = clamp(top, 0, 100 - MIN_CROP_PCT);
  bottom = clamp(bottom, 0, 100 - MIN_CROP_PCT);
  if (left + right > 100 - MIN_CROP_PCT) {
    const scale = (100 - MIN_CROP_PCT) / (left + right);
    left *= scale;
    right *= scale;
  }
  if (top + bottom > 100 - MIN_CROP_PCT) {
    const scale = (100 - MIN_CROP_PCT) / (top + bottom);
    top *= scale;
    bottom *= scale;
  }
  return { top, right, bottom, left };
}

function insetsToPercentCrop(e: EdgeInsetPct): PercentCrop {
  const ins = clampInsets(e);
  return {
    unit: "%",
    x: ins.left,
    y: ins.top,
    width: 100 - ins.left - ins.right,
    height: 100 - ins.top - ins.bottom,
  };
}

export interface ImageCropDialogProps {
  file: File | null;
  indexLabel: string;
  busy?: boolean;
  onConfirmCropped: (file: File) => void;
  onUseOriginal: (file: File) => void;
  onAbortQueue: () => void;
}

export function ImageCropDialog({
  file,
  indexLabel,
  busy = false,
  onConfirmCropped,
  onUseOriginal,
  onAbortQueue,
}: ImageCropDialogProps): JSX.Element | null {
  const titleId = useId();
  const imgRef = useRef<HTMLImageElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  /** 不传 `aspect`：可拖四角/四边；另配有四边滑块微调 */
  const [crop, setCrop] = useState<Crop>();
  const completedCropRef = useRef<PixelCrop | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCrop(undefined);
      completedCropRef.current = null;
      setError("");
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setCrop(undefined);
    completedCropRef.current = null;
    setError("");
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { width, height } = img;
    const initial = centerCrop(
      {
        unit: "%",
        width: 82,
        height: 72,
      },
      width,
      height
    );
    setCrop(initial);
  }, []);

  const onCropComplete = useCallback((c: PixelCrop) => {
    completedCropRef.current = c;
  }, []);

  const applyEdgeInset = useCallback((key: keyof EdgeInsetPct, raw: number) => {
    setCrop((prev) => {
      if (!prev || prev.unit !== "%") return prev;
      const ins = percentCropToInsets(prev as PercentCrop);
      const next = clampInsets({ ...ins, [key]: raw });
      return insetsToPercentCrop(next);
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!file || !objectUrl || exporting) return;
    const img = imgRef.current;
    const pix = completedCropRef.current;
    if (!img || !pix || pix.width < 2 || pix.height < 2) {
      setError("请拖四角/四边调整裁切框，或用下方滑块微调四边，再点确认。");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const { blob, mime, ext } = await getCroppedImageBlobFromImageElement(img, pix, file.type);
      const name = croppedFileName(file.name, ext);
      onConfirmCropped(new File([blob], name, { type: mime }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "裁切导出失败");
    } finally {
      setExporting(false);
    }
  }, [file, objectUrl, exporting, onConfirmCropped]);

  const handleOriginal = useCallback(async () => {
    if (!file || exporting) return;
    setExporting(true);
    setError("");
    try {
      const out = await reencodeToJpegIfNeeded(file);
      onUseOriginal(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法处理原图，请改用「确认裁切」或导出为 JPG 再选");
    } finally {
      setExporting(false);
    }
  }, [file, exporting, onUseOriginal]);

  if (!file || !objectUrl) return null;

  const disabled = busy || exporting;
  const inset =
    crop?.unit === "%" ? percentCropToInsets(crop as PercentCrop) : { top: 0, right: 0, bottom: 0, left: 0 };

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="crop-sheet">
        <header className="crop-header">
          <h2 id={titleId} className="crop-title">
            裁切图片 <span className="crop-index">{indexLabel}</span>
          </h2>
          <p className="crop-hint">
            <strong>拖白色角点 / 边线</strong>改变裁切区大小；拖<strong>框内</strong>平移。也可用下方滑块<strong>单独移动四边</strong>（像调参考线）。若仍见「双指缩放」旧界面，请<strong>强刷或重新构建前端</strong>。
          </p>
        </header>
        <div className="crop-stage crop-stage--free">
          <ReactCrop
            crop={crop}
            onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
            onComplete={(c) => onCropComplete(c)}
            minWidth={28}
            minHeight={28}
            className="react-crop-in-dialog"
          >
            <img
              ref={imgRef}
              src={objectUrl}
              alt="待裁切"
              className="crop-img"
              onLoad={onImageLoad}
            />
          </ReactCrop>
        </div>

        {crop?.unit === "%" ? (
          <div className="crop-inset-panel">
            <p className="crop-inset-title">四边微调（%）</p>
            <div className="crop-inset-grid">
              <label className="crop-inset-cell">
                <span>上边距</span>
                <input
                  type="range"
                  min={0}
                  max={88}
                  step={0.5}
                  value={inset.top}
                  onChange={(e) => applyEdgeInset("top", Number(e.target.value))}
                  disabled={disabled}
                />
              </label>
              <label className="crop-inset-cell">
                <span>下边距</span>
                <input
                  type="range"
                  min={0}
                  max={88}
                  step={0.5}
                  value={inset.bottom}
                  onChange={(e) => applyEdgeInset("bottom", Number(e.target.value))}
                  disabled={disabled}
                />
              </label>
              <label className="crop-inset-cell">
                <span>左边距</span>
                <input
                  type="range"
                  min={0}
                  max={88}
                  step={0.5}
                  value={inset.left}
                  onChange={(e) => applyEdgeInset("left", Number(e.target.value))}
                  disabled={disabled}
                />
              </label>
              <label className="crop-inset-cell">
                <span>右边距</span>
                <input
                  type="range"
                  min={0}
                  max={88}
                  step={0.5}
                  value={inset.right}
                  onChange={(e) => applyEdgeInset("right", Number(e.target.value))}
                  disabled={disabled}
                />
              </label>
            </div>
          </div>
        ) : null}

        {error ? <p className="crop-error">{error}</p> : null}
        <footer className="crop-footer">
          <button type="button" className="secondary" onClick={onAbortQueue} disabled={disabled}>
            取消全部
          </button>
          <button type="button" className="secondary" onClick={() => void handleOriginal()} disabled={disabled}>
            本张用原图
          </button>
          <button type="button" onClick={() => void handleConfirm()} disabled={disabled}>
            {exporting ? "导出中…" : "确认裁切"}
          </button>
        </footer>
      </div>
    </div>
  );
}
