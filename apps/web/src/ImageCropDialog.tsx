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
  /** 不传 `aspect`：自由长宽比，拖四角 / 四边 */
  const [crop, setCrop] = useState<Crop>();
  const completedCropRef = useRef<PixelCrop | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!file) {
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCrop(undefined);
      completedCropRef.current = null;
      setError("");
      setPreviewBlobUrl((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
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
    setPreviewBlobUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    previewUrlRef.current = previewBlobUrl;
  }, [previewBlobUrl]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

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

  const clearPreview = useCallback(() => {
    setPreviewBlobUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
  }, []);

  const handlePreview = useCallback(async () => {
    if (!file || !objectUrl || previewGenerating || exporting) return;
    const img = imgRef.current;
    const pix = completedCropRef.current;
    if (!img || !pix || pix.width < 2 || pix.height < 2) {
      setError("请先调整裁切区域，再点预览。");
      return;
    }
    setPreviewGenerating(true);
    setError("");
    try {
      const { blob } = await getCroppedImageBlobFromImageElement(img, pix, file.type);
      setPreviewBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览生成失败");
    } finally {
      setPreviewGenerating(false);
    }
  }, [file, objectUrl, previewGenerating, exporting]);

  const handleConfirm = useCallback(async () => {
    if (!file || !objectUrl || exporting) return;
    const img = imgRef.current;
    const pix = completedCropRef.current;
    if (!img || !pix || pix.width < 2 || pix.height < 2) {
      setError("请先拖角点或边线调整裁切区域，再确认。");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const { blob, mime, ext } = await getCroppedImageBlobFromImageElement(img, pix, file.type);
      clearPreview();
      const name = croppedFileName(file.name, ext);
      onConfirmCropped(new File([blob], name, { type: mime }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "裁切导出失败");
    } finally {
      setExporting(false);
    }
  }, [file, objectUrl, exporting, onConfirmCropped, clearPreview]);

  const handleOriginal = useCallback(async () => {
    if (!file || exporting) return;
    setExporting(true);
    setError("");
    clearPreview();
    try {
      const out = await reencodeToJpegIfNeeded(file);
      onUseOriginal(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法处理原图，请改用「确认裁切」或导出为 JPG 再选");
    } finally {
      setExporting(false);
    }
  }, [file, exporting, onUseOriginal, clearPreview]);

  if (!file || !objectUrl) return null;

  const disabled = busy || exporting || previewGenerating;

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="crop-sheet">
        <header className="crop-header">
          <h2 id={titleId} className="crop-title">
            裁切 <span className="crop-index">{indexLabel}</span>
          </h2>
          <p className="crop-hint crop-hint--primary">拖<strong>角点</strong>或<strong>边线</strong>调大小；拖<strong>框内</strong>移动选区。</p>
          <details className="crop-help-more">
            <summary className="crop-help-more-summary">更多说明</summary>
            <p className="crop-help-more-body">
              GIF 裁切后为静态 PNG。若仍出现带「双指缩放」滑条的老界面，请强制刷新页面或重新部署前端资源。
            </p>
          </details>
        </header>
        <div className="crop-stage crop-stage--free">
          <div className="crop-stage-inner">
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
        </div>

        <div className="crop-preview-bar">
          <button
            type="button"
            className="secondary crop-preview-trigger"
            onClick={() => void handlePreview()}
            disabled={busy || exporting || previewGenerating}
          >
            {previewGenerating ? "生成预览中…" : previewBlobUrl ? "刷新预览" : "预览裁切效果"}
          </button>
        </div>

        {previewBlobUrl ? (
          <div className="crop-preview-frame">
            <img src={previewBlobUrl} alt="当前选区裁切后的预览" className="crop-preview-img" />
            <div className="crop-preview-actions">
              <button
                type="button"
                className="crop-preview-confirm-btn"
                onClick={() => void handleConfirm()}
                disabled={disabled}
              >
                {exporting ? "导出中…" : "确认裁切"}
              </button>
              <button type="button" className="secondary crop-preview-dismiss-btn" onClick={clearPreview} disabled={busy || exporting}>
                关闭预览
              </button>
            </div>
            <p className="crop-preview-caption">以上为按当前选区导出的效果；满意可直接点上方「确认裁切」，底部工具栏也可同样操作。</p>
          </div>
        ) : null}

        {error ? <p className="crop-error">{error}</p> : null}
        <footer className="crop-footer crop-footer--actions">
          <button type="button" className="secondary crop-footer-btn" onClick={onAbortQueue} disabled={disabled}>
            取消全部
          </button>
          <button type="button" className="secondary crop-footer-btn" onClick={() => void handleOriginal()} disabled={disabled}>
            原图
          </button>
          <button type="button" className="crop-footer-btn crop-footer-btn--primary" onClick={() => void handleConfirm()} disabled={disabled}>
            {exporting ? "导出中…" : "确认裁切"}
          </button>
        </footer>
      </div>
    </div>
  );
}
