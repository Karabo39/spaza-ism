"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  importColumns,
  importTemplate,
  parseImport,
  type ImportKind,
  type ImportRow,
} from "./import-format";
type Preview = {
  ok: boolean;
  error?: string;
  row?: number;
  rows?: {
    id: string;
    name: string;
    action: string;
    row: number;
    quantity_before: number | null;
    quantity_after: number | null;
    input: ImportRow;
  }[];
};
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ImportConsole({initialKind="products"}:{initialKind?:ImportKind}) {
  const { store, can } = useStore(),
    { online } = useOffline(),
    router = useRouter(),
    cache = useQueryClient();
  const [kind, setKind] = useState<ImportKind>(initialKind),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null),
    [filename, setFilename] = useState("");
  const request = useRef<string | null>(null),
    fileInput = useRef<HTMLInputElement>(null);
  if (!can("manager"))
    return <p>Imports are available to owners and managers.</p>;
  async function download(existing: boolean) {
    setBusy(true);
    try {
      const db = createClient();
      let rows: Record<string, unknown>[] = [];
      if (existing) {
        let query =
          kind === "products"
            ? db.from("v_product_stock").select("*").eq("store_id", store.id)
            : kind === "suppliers"
              ? db
                  .from("suppliers")
                  .select("*")
                  .eq("business_id", store.businessId)
              : db
                  .from("v_credit_customers")
                  .select("*")
                  .eq("store_id", store.id);
        if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
        const { data, error } = await query.order("name").limit(201);
        if (error) throw error;
        if (!data?.length) throw new Error("No matching records to download.");
        if (data.length > 200)
          throw new Error(
            "More than 200 records match. Narrow the name search and download again.",
          );
        rows = data.map((row) => ({
          ...row,
          id: "customer_id" in row ? row.customer_id : row.id,
        }));
      }
      save(
        await importTemplate(kind, rows),
        `${kind}-${existing ? "existing" : "template"}.xlsx`,
      );
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(file: File) {
    setBusy(true);
    setPreview(null);
    setFilename(file.name);
    request.current = null;
    try {
      if (!/\.xlsx$/i.test(file.name) || file.size > 2_000_000)
        throw new Error("Choose an .xlsx file smaller than 2 MB.");
      const rows = await parseImport(kind, await file.arrayBuffer());
      const { data, error } = await createClient().rpc("import_excel", {
        p_store: store.id,
        p_kind: kind,
        p_rows: rows,
        p_request: crypto.randomUUID(),
        p_preview: true,
      });
      if (error) throw error;
      setPreview(data as Preview);
      request.current = crypto.randomUUID();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!preview?.ok || !preview.rows || !request.current || !online || busy)
      return;
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("import_excel", {
        p_store: store.id,
        p_kind: kind,
        p_rows: preview.rows.map((r) => r.input),
        p_request: request.current,
        p_preview: false,
      });
      if (error) throw error;
      const result = data as Preview;
      if (!result.ok) {
        setPreview(result);
        return;
      }
      toast.success(`${result.rows?.length} records imported.`);
      setPreview(null);
      setFilename("");
      request.current = null;
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
      await cache.invalidateQueries();
    } catch {
      toast.error(
        "Could not confirm the import. Reconnect and retry with this preview; the same request cannot import twice.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex items-center gap-3">
          <FileSpreadsheet className="size-6 text-primary-hover" />
          <div>
            <h2 className="font-semibold">Import into {store.name}</h2>
            <p className="text-sm text-muted">
              Online only · Owners and managers · Up to 200 records per file
            </p>
          </div>
        </div>
        <label className="block text-sm">
          Record type
          <select
            className="mt-1 block h-10 w-full max-w-sm rounded-md border border-border bg-input px-3"
            value={kind}
            disabled={busy}
            onChange={(e) => {
              setKind(e.target.value as ImportKind);
              setPreview(null);
              setFilename("");
              if (fileInput.current) fileInput.current.value = "";
            }}
          >
            <option value="products">Products and stock quantity</option>
            <option value="suppliers">Suppliers</option>
            <option value="customers">Credit customers</option>
          </select>
        </label>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => download(false)}
          >
            <Download className="size-4" />
            Blank template
          </Button>
          <label className="text-sm">
            Find existing records
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name contains…"
            />
          </label>
          <Button
            variant="secondary"
            disabled={busy || !online}
            onClick={() => download(true)}
          >
            Download existing records
          </Button>
        </div>
        <p className="mt-4 text-sm text-muted">
          Keep the template columns unchanged. Blank cells preserve existing
          values. Products match their ID or barcode; suppliers and customers
          match their ID. Suppliers are shared across {store.businessName}.
        </p>
        <p className="mt-2 text-sm text-muted">
          Product quantity sets the total on hand. Expiry-tracked increases need
          an expiry date. Customer imports change contact details and credit
          limits; balances are maintained by transactions.
        </p>
        <label className="mt-5 block text-sm font-medium">
          Choose completed Excel template
          <Input
            ref={fileInput}
            className="mt-1 max-w-lg"
            type="file"
            accept=".xlsx"
            disabled={busy || !online}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void review(file);
            }}
          />
        </label>
        {!online && (
          <p className="mt-2 text-sm text-warning">
            Connect to review and confirm an import.
          </p>
        )}
      </section>
      {busy && (
        <p role="status" className="text-sm text-muted">
          Preparing your import…
        </p>
      )}
      {preview && !preview.ok && (
        <div role="alert" className="rounded-lg border border-danger/40 p-4">
          <p className="font-medium">
            Row {preview.row}: {preview.error?.replaceAll("_", " ")}
          </p>
          <p className="mt-1 text-sm">
            Nothing was imported. Correct the file or download fresh records,
            then choose the file again.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            onClick={() => {
              setPreview(null);
              if (fileInput.current) fileInput.current.value = "";
            }}
          >
            Choose corrected file
          </Button>
        </div>
      )}
      {preview?.ok && (
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-semibold">Review {filename}</h2>
          <p className="mt-1 text-sm text-muted">
            {preview.rows?.length} records · {store.name}. Confirming applies
            all rows together. Quantity changes are checked again before saving.
          </p>
          <div className="my-4 max-h-96 overflow-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Row</TH>
                  <TH>Action</TH>
                  <TH>Name</TH>
                  {kind === "products" && (
                    <>
                      <TH>Stock before</TH>
                      <TH>Stock after</TH>
                    </>
                  )}
                  <TH>Fields supplied</TH>
                </TR>
              </THead>
              <TBody>
                {preview.rows?.map((row) => (
                  <TR key={row.row}>
                    <TD>{row.row}</TD>
                    <TD>{row.action}</TD>
                    <TD>{row.name}</TD>
                    {kind === "products" && (
                      <>
                        <TD>{row.quantity_before}</TD>
                        <TD>{row.quantity_after}</TD>
                      </>
                    )}
                    <TD className="max-w-md whitespace-normal text-xs">
                      {importColumns[kind]
                        .filter(
                          (key) => key !== "id" && row.input[key] !== undefined,
                        )
                        .map(
                          (key) =>
                            `${key.replaceAll("_", " ")}: ${row.input[key]}`,
                        )
                        .join(" · ")}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Button onClick={confirm} loading={busy} disabled={!online}>
            <Upload className="size-4" />
            Confirm {preview.rows?.length} records
          </Button>
        </section>
      )}
    </div>
  );
}
