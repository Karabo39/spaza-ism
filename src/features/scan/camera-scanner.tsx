"use client";
import * as React from "react";
import { X, Zap, ZapOff, Camera, RefreshCw } from "lucide-react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { cn } from "@/lib/utils";

/**
 * Full-screen camera barcode scanner. Detected codes are handed to `onDetected`
 * and the camera keeps running so several items can be scanned in a row
 * (Goods In / Goods Out). Duplicate reads within ~1.4s are ignored.
 */
export function CameraScanner({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDetected: (code: string) => void;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const lastRef = React.useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(true);
  const [lastCode, setLastCode] = React.useState<string | null>(null);
  const [torchOn, setTorchOn] = React.useState(false);
  const [torchable, setTorchable] = React.useState(false);

  const stop = React.useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
  }, []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setStarting(true);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
    ]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

    (async () => {
      try {
        const controls = await reader.decodeFromVideoDevice(
          undefined, // let the browser pick; constraints below prefer the back camera
          videoRef.current!,
          (result) => {
            if (cancelled || !result) return;
            const code = result.getText().trim();
            const now = Date.now();
            if (code === lastRef.current.code && now - lastRef.current.at < 1400) return;
            lastRef.current = { code, at: now };
            setLastCode(code);
            if (navigator.vibrate) navigator.vibrate(40);
            onDetected(code);
          },
        );
        if (cancelled) { controls.stop(); return; }
        controlsRef.current = controls;
        setStarting(false);

        // Torch capability probe.
        const stream = videoRef.current?.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks?.()[0];
        const caps = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        if (caps?.torch) setTorchable(true);
      } catch (e) {
        if (cancelled) return;
        const err = e as Error;
        setError(
          err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and try again."
            : err.name === "NotFoundError"
            ? "No camera found on this device."
            : "Could not start the camera. You can still use a USB scanner or type the code.",
        );
        setStarting(false);
      }
    })();

    return () => { cancelled = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function toggleTorch() {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn((t) => !t);
    } catch { /* torch not supported */ }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Camera className="size-5" />
          <span className="text-sm font-medium">Scan with camera</span>
        </div>
        <div className="flex items-center gap-1">
          {torchable ? (
            <button onClick={toggleTorch} className="rounded-full p-2 hover:bg-white/10" aria-label="Toggle torch">
              {torchOn ? <Zap className="size-5 text-warning" /> : <ZapOff className="size-5" />}
            </button>
          ) : null}
          <button onClick={() => onOpenChange(false)} className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline autoPlay />
        {/* Reticle */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className={cn("h-40 w-72 max-w-[80%] rounded-xl border-2", lastCode ? "border-success" : "border-white/80")}>
            <div className="absolute inset-x-0 top-1/2 mx-auto h-0.5 w-72 max-w-[80%] -translate-y-1/2 bg-primary/70" />
          </div>
        </div>

        {starting && !error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
            <RefreshCw className="mr-2 size-5 animate-spin" /> Starting camera…
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-white">
            <p className="text-sm">{error}</p>
            <button onClick={() => onOpenChange(false)} className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/20">
              Close
            </button>
          </div>
        ) : null}
      </div>

      <div className="px-4 py-4 text-center text-white">
        {lastCode ? (
          <p className="text-sm">Last scanned: <span className="font-mono text-success">{lastCode}</span></p>
        ) : (
          <p className="text-sm text-white/70">Point the camera at a barcode. Keep scanning to add more.</p>
        )}
        <button onClick={() => onOpenChange(false)} className="mt-3 rounded-md bg-primary px-6 py-2 text-sm font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
