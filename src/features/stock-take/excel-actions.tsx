"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/format";
import type { ImportedCount, StockTakeTemplate } from "./excel";

export function StockTakeExcelActions({
  stockTakeId,
  disabled = false,
}: {
  stockTakeId?: string;
  disabled?: boolean;
}) {
  const { store } = useStore(),
    { online } = useOffline(),
    router = useRouter(),
    cache = useQueryClient();
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false),
    exportRequest = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    exportId: string;
    stockTakeId: string;
    rows: ImportedCount[];
  } | null>(null);
  const unavailable = disabled || !online || busy;
  function path(id: string) {
    return `${store.locationType === "warehouse" ? `/warehouse/${store.id}` : ""}/stock-take/${id}`;
  }
  async function exportTemplate() {
    if (unavailable || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      exportRequest.current ??= crypto.randomUUID();
      const { data, error } = await createClient().rpc(
        "export_stock_take_template",
        {
          p_store: store.id,
          p_export: exportRequest.current,
          ...(stockTakeId ? { p_stock_take: stockTakeId } : {}),
        },
      );
      if (error) throw error;
      const template = data as unknown as StockTakeTemplate;
      const { createStockTakeWorkbook } = await import("./excel");
      const bytes = await createStockTakeWorkbook(template);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock-take-${template.stock_take_id}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      exportRequest.current = null;
      toast.success(
        "Template downloaded. Enter counts or TRUE, then import. Manager approval is still required.",
      );
      router.push(path(template.stock_take_id));
      router.refresh();
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function readFile(file: File | undefined) {
    if (!file || unavailable || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".xlsx"))
        throw new Error("Choose an Excel .xlsx stock-take template.");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("The workbook must be smaller than 10 MB.");
      const { readStockTakeWorkbook } = await import("./excel");
      setPreview(
        await readStockTakeWorkbook(
          await file.arrayBuffer(),
          store.id,
          stockTakeId,
        ),
      );
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      lock.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function saveImport() {
    if (!preview || unavailable || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc(
        "import_stock_take_template",
        { p_store: store.id, p_export: preview.exportId, p_rows: preview.rows },
      );
      if (error || !data) throw error ?? new Error("Could not save counts.");
      await cache.invalidateQueries({ queryKey: ["stock-take-items", data] });
      setPreview(null);
      toast.success(
        "Counts saved. A manager can review and approve the stock take.",
      );
      router.push(path(data));
      router.refresh();
    } catch (e) {
      toast.error(friendlyError((e as Error).message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button size="sm" disabled={unavailable} onClick={exportTemplate}>
        <Download className="size-4" />
        Export template
      </Button>
      <Button
        size="sm"
        disabled={unavailable}
        onClick={() => input.current?.click()}
      >
        <Upload className="size-4" />
        Import Stock Take
      </Button>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept=".xlsx"
        aria-label="Stock take workbook"
        onChange={(e) => void readFile(e.target.files?.[0])}
      />
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open && !busy) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import stock-take counts</DialogTitle>
            <DialogDescription>
              Save {preview?.rows.length ?? 0} product counts for {store.name}.{" "}
              {preview?.rows.filter((r) => r.same).length ?? 0} use Still the
              Same. Blank counts are skipped. Stock will only change after
              manager approval.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted">
            Changed stock or counts are rejected. No rows are saved if the
            workbook fails validation.
          </p>
          <Button
            loading={busy}
            disabled={disabled || !online}
            onClick={saveImport}
          >
            Save imported counts
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
