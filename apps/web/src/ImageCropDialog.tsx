import { useCallback, useEffect, useId, useRef, useState } from "react";
import ReactCrop, { centerCrop, type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { croppedFileName, getCroppedImageBlobFromImageElement } from "./getCroppedImage";
import { reencodeToJpegIfNeeded } from "./imageNormalize";

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
  /** 不传 `aspect` 即为自由长宽比，可拖四角/四边调整 */
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

  const handleConfirm = useCallback(async () => {
    if (!file || !objectUrl || exporting) return;
    const img = imgRef.current;
    const pix = completedCropRef.current;
    if (!img || !pix || pix.width < 2 || pix.height < 2) {
      setError("请先在图上拖出裁切框（可拖角、拖边改变长宽），并稍等加载完成。");
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

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="crop-sheet">
        <header className="crop-header">
          <h2 id={titleId} className="crop-title">
            裁切图片 <span className="crop-index">{indexLabel}</span>
          </h2>
          <p className="crop-hint">
            拖动四角或边可<strong>自由改变裁切区长和宽</strong>；拖动框内可平移。GIF 裁切后为静态 PNG。
          </p>
        </header>
        <div className="crop-stage crop-stage--free">
          <ReactCrop
            crop={crop}
            onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
            onComplete={(c) => onCropComplete(c)}
            minWidth={24}
            minHeight={24}
            ruleOfThirds
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
