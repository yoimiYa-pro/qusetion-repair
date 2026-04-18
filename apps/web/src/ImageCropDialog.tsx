import { useCallback, useEffect, useId, useRef, useState } from "react";
import Cropper, { type Area, type MediaSize } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { croppedFileName, getCroppedImageBlob } from "./getCroppedImage";

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
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(4 / 3);
  const croppedAreaPixelsRef = useRef<Area | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setAspect(4 / 3);
      croppedAreaPixelsRef.current = null;
      setError("");
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setError("");
    croppedAreaPixelsRef.current = null;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    croppedAreaPixelsRef.current = areaPixels;
  }, []);

  const onMediaLoaded = useCallback((ms: MediaSize) => {
    const r = ms.naturalWidth / Math.max(1, ms.naturalHeight);
    setAspect(Number.isFinite(r) && r > 0 ? r : 4 / 3);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!file || !objectUrl || exporting) return;
    const pix = croppedAreaPixelsRef.current;
    if (!pix) {
      setError("请稍等画面加载完成后再试，或双指缩放调整选区。");
      return;
    }
    setExporting(true);
    setError("");
    try {
      const { blob, mime, ext } = await getCroppedImageBlob(objectUrl, pix, file.type);
      const name = croppedFileName(file.name, ext);
      onConfirmCropped(new File([blob], name, { type: mime }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "裁切导出失败");
    } finally {
      setExporting(false);
    }
  }, [file, objectUrl, exporting, onConfirmCropped]);

  const handleOriginal = useCallback(() => {
    if (!file || exporting) return;
    onUseOriginal(file);
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
          <p className="crop-hint">双指缩放、拖动画面以框选题干区域；GIF 裁切后为静态 PNG。</p>
        </header>
        <div className="crop-stage">
          <Cropper
            image={objectUrl}
            crop={crop}
            zoom={zoom}
            minZoom={0.35}
            maxZoom={4}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            onMediaLoaded={onMediaLoaded}
            rotation={0}
            restrictPosition
            cropShape="rect"
            showGrid
            zoomWithScroll={false}
            classes={{}}
            style={{
              containerStyle: {
                width: "100%",
                height: "100%",
                touchAction: "none",
              },
            }}
          />
        </div>
        <div className="crop-zoom">
          <label htmlFor="crop-zoom-range">缩放</label>
          <input
            id="crop-zoom-range"
            type="range"
            min={0.35}
            max={4}
            step={0.02}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={disabled}
          />
        </div>
        {error ? <p className="crop-error">{error}</p> : null}
        <footer className="crop-footer">
          <button type="button" className="secondary" onClick={onAbortQueue} disabled={disabled}>
            取消全部
          </button>
          <button type="button" className="secondary" onClick={handleOriginal} disabled={disabled}>
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
