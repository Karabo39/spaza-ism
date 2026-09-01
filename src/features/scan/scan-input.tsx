"use client";
import * as React from "react";
import { ScanLine, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Large barcode scan field optimised for USB keyboard-wedge scanners.
 * Scanners "type" the code then send Enter -> we fire onScan and clear.
 * The field keeps focus so the operator never needs the mouse.
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

  const refocus = React.useCallback(() => ref.current?.focus(), []);

  React.useEffect(() => {
    if (autoFocus) refocus();
  }, [autoFocus, refocus]);

  async function submit() {
    const code = value.trim();
    if (!code || busy) return;
    setValue("");
    await onScan(code);
    refocus();
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border-2 bg-input px-4 py-3 transition-colors",
        busy ? "border-primary/60" : "border-primary/40 scan-active",
      )}
      onClick={refocus}
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
        onBlur={() => { if (autoFocus) setTimeout(refocus, 60); }}
        placeholder={placeholder}
        className="h-8 flex-1 bg-transparent text-lg text-foreground placeholder:text-muted focus:outline-none"
      />
      {busy ? (
        <Loader2 className="size-5 animate-spin text-muted" />
      ) : value ? (
        <button onClick={() => { setValue(""); refocus(); }} className="text-muted hover:text-foreground">
          <X className="size-5" />
        </button>
      ) : null}
    </div>
  );
}
