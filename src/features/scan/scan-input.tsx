"use client";
import * as React from "react";
import { ScanLine, Loader2, X, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { CameraScanner } from "./camera-scanner";

/**
 * Large barcode scan field optimised for USB keyboard-wedge scanners.
 * Scanners "type" the code then send Enter -> we fire onScan and clear.
 * The field keeps focus so the operator never needs the mouse.
 *
 * A camera button opens a live camera scanner (mobile / laptops with a
 * webcam); detected codes go through the same onScan pipeline.
 */
export function ScanInput({
  onScan,
  busy,
  placeholder = "Scan barcode or type product name, then Enter",
  autoFocus = true,
}: {
  onScan: (code: string) => void | Promise<void>;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState("");
  const [cameraOpen, setCameraOpen] = React.useState(false);
  const [hasCamera, setHasCamera] = React.useState(false);

  const refocus = React.useCallback(() => ref.current?.focus(), []);

  React.useEffect(() => {
    if (autoFocus && !cameraOpen) refocus();
  }, [autoFocus, refocus, cameraOpen]);

  // Only show the camera button where the API + a video input exist.
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => setHasCamera(devices.some((d) => d.kind === "videoinput")))
      .catch(() => setHasCamera(false));
  }, []);

  async function submit() {
    const code = value.trim();
    if (!code || busy) return;
    setValue("");
    await onScan(code);
    refocus();
  }

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border-2 bg-input px-4 py-3 transition-colors",
          busy ? "border-primary/60" : "border-primary/40 scan-active",
        )}
        onClick={() => { if (!cameraOpen) refocus(); }}
      >
        <ScanLine className="size-6 shrink-0 text-primary-hover" />
        <input
          ref={ref}
          value={value}
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void submit(); }
          }}
          onBlur={() => { if (autoFocus && !cameraOpen) setTimeout(refocus, 60); }}
          placeholder={placeholder}
          className="h-8 flex-1 bg-transparent text-lg text-foreground placeholder:text-muted focus:outline-none"
        />
        {busy ? (
          <Loader2 className="size-5 animate-spin text-muted" />
        ) : value ? (
          <button onClick={() => { setValue(""); refocus(); }} className="text-muted hover:text-foreground" aria-label="Clear">
            <X className="size-5" />
          </button>
        ) : null}
        {hasCamera ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setCameraOpen(true); }}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-label="Scan with camera"
          >
            <Camera className="size-4" /> <span className="hidden sm:inline">Camera</span>
          </button>
        ) : null}
      </div>

      <CameraScanner
        open={cameraOpen}
        onOpenChange={(v) => { setCameraOpen(v); if (!v) refocus(); }}
        onDetected={(code) => { void onScan(code); }}
      />
    </>
  );
}
