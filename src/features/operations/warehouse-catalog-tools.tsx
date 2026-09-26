"use client";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  importTemplate,
  parseImport,
  type ImportRow,
} from "@/features/imports/import-format";
import { dateTime, friendlyError } from "@/lib/format";
type Result = {
  created?: number;
  updated?: number;
  skipped?: number;
  error?: string;
  errors?: { row: number; name: string; error: string }[];
};
const errors: Record<string, string> = {
  CONFLICTING_PRODUCT_IDENTIFIERS:
    "SKU and barcode match different products. Correct them before retrying.",
  CONFLICTING_PRODUCT_STRUCTURE:
    "Stores use different units or expiry tracking for this product.",
  STOCK_STRUCTURE_REQUIRES_REVIEW:
    "Existing stock, a transfer or a bulk conversion prevents changing units or expiry tracking.",
  CURRENCY_MISMATCH:
    "Source store and warehouse currencies differ. Prices need review.",
  WAREHOUSE_PRODUCT_INACTIVE: "The matched warehouse product is inactive.",
  SKU_OR_BARCODE_REQUIRED:
    "Add a SKU or barcode, or use a store template with product IDs.",
  SOURCE_PRODUCT_NOT_IN_BUSINESS:
    "The template ID must belong to a selling store in this business.",
  INVALID_PRODUCT_ROW: "Check the product values and try again.",
};
export function WarehouseCatalogTools() {
  const { can, store, stores } = useStore();
  const [open, setOpen] = useState(false);
  const warehouses = stores.filter(
    (s) =>
      s.businessId === store.businessId &&
      s.locationType === "warehouse" &&
      s.modules.warehouse &&
      (store.locationType !== "warehouse" || s.id === store.id),
  );
  if (!can("owner") || !warehouses.length) return null;
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Sync Products
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <CatalogPanel key={store.businessId} />}
      </Dialog>
    </>
  );
}
function CatalogPanel() {
  const { store, stores, user } = useStore();
  const { online } = useOffline();
  const router = useRouter();
  const lock = useRef(false);
  const warehouses = stores.filter(
    (s) =>
      s.businessId === store.businessId &&
      s.locationType === "warehouse" &&
      s.modules.warehouse &&
      (store.locationType !== "warehouse" || s.id === store.id),
  );
  const sources = stores.filter(
    (s) => s.businessId === store.businessId && s.locationType === "store",
  );
  const [warehouse, setWarehouse] = useState(
    store.locationType === "warehouse" ? store.id : warehouses[0]?.id || "",
  );
  const [source, setSource] = useState(
    store.locationType === "store" ? store.id : "",
  );
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [filename, setFilename] = useState("");
  const [search, setSearch] = useState("");
  const draftKey = (id: string) => `warehouse-catalog-draft:${user.id}:${id}`;
  const settings = useQuery({
    queryKey: ["warehouse-sync-settings", warehouse],
    enabled: online && !!warehouse,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("warehouse_sync_settings")
        .select("*")
        .eq("warehouse_id", warehouse)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  async function act(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(friendlyError((e as Error).message));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const last = result || (settings.data?.last_result as Result | null);
  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Warehouse products</DialogTitle>
        <DialogDescription>
          Sync or import product details. Warehouse quantities and expiry
          batches remain unchanged.
        </DialogDescription>
      </DialogHeader>
      <Label htmlFor="sync-warehouse">Warehouse</Label>
      <select
        id="sync-warehouse"
        className="h-10 rounded border border-border bg-input px-2"
        value={warehouse}
        disabled={busy}
        onChange={(e) => {
          setWarehouse(e.target.value);
          setRows(null);
          setFilename("");
          setResult(null);
        }}
      >
        {warehouses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.currency}
          </option>
        ))}
      </select>
      <Label htmlFor="sync-source">Preferred source for names and prices</Label>
      <select
        id="sync-source"
        className="h-10 rounded border border-border bg-input px-2"
        value={source}
        disabled={busy}
        onChange={(e) => setSource(e.target.value)}
      >
        <option value="">Choose a rule</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.currency}
          </option>
        ))}
        <option value="latest">
          Most recently updated product across stores
        </option>
      </select>
      <p className="text-xs text-muted">
        All selling stores are checked. Products match by SKU or barcode;
        imported store IDs keep later updates linked. Different currencies and
        conflicting identifiers are reported for review. Pack conversion ratios
        remain managed in Unpack Bulk Stock.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={auto}
          onChange={(e) => setAuto(e.target.checked)}
          disabled={busy}
        />
        Run automatically every 30 minutes after this sync
      </label>
      {settings.data && (
        <p className="text-xs text-muted">
          Saved schedule:{" "}
          {settings.data.enabled ? "Every 30 minutes" : "Paused"}. Last run:{" "}
          {settings.data.last_run_at
            ? dateTime(settings.data.last_run_at)
            : "Not yet run"}
          .{" "}
          <button
            className="text-accent underline"
            disabled={busy}
            onClick={() => {
              setSource(settings.data!.preferred_store_id || "latest");
              setAuto(settings.data!.enabled);
            }}
          >
            Use saved settings
          </button>
        </p>
      )}
      <Button
        disabled={!online || !source || !warehouse}
        loading={busy}
        onClick={() =>
          void act(async () => {
            if (!online) throw Error("Reconnect before applying changes.");
            const { data, error } = await createClient().rpc(
              "sync_warehouse_products",
              {
                p_warehouse: warehouse,
                p_preferred: source === "latest" ? null : source,
                p_auto: auto,
              },
            );
            if (error) throw error;
            setResult(data as Result);
            await settings.refetch();
            router.refresh();
          })
        }
      >
        Sync products and save schedule
      </Button>
      <section className="space-y-3 border-t border-border pt-4">
        <h3 className="font-semibold">Import a store product template</h3>
        <p className="text-xs text-muted">
          Download up to 200 matching products from the selected store, or
          upload its existing product template. Quantities in uploaded files are
          ignored. You can review a file offline and apply it after
          reconnecting.
        </p>
        <Input
          aria-label="Filter template products"
          placeholder="Product name, SKU or barcode"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={busy}
        />
        <Button
          variant="primary"
          disabled={!online || !source || source === "latest" || busy}
          onClick={() =>
            void act(async () => {
              let q = createClient()
                .from("v_product_catalog")
                .select("*")
                .eq("store_id", source)
                .eq("is_active", true)
                .order("name")
                .limit(201);
              if (search.trim())
                q = q.ilike(
                  "search_text",
                  `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`,
                );
              const { data, error } = await q;
              if (error) throw error;
              if ((data?.length || 0) > 200)
                throw Error("More than 200 products match. Narrow the search.");
              const template = (data || []).map((p) => ({
                ...p,
                barcode: p.barcodes.split(", ")[0] || "",
                quantity: 0,
              }));
              const url = URL.createObjectURL(
                await importTemplate("products", template),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "warehouse-store-products.xlsx";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })
          }
        >
          Download store template
        </Button>
        <Input
          aria-label="Upload warehouse product template"
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setRows(null);
            void act(async () => {
              if (!/\.xlsx$/i.test(file.name) || file.size > 2000000)
                throw Error("Choose an .xlsx file smaller than 2 MB.");
              const parsed = (
                await parseImport("products", await file.arrayBuffer())
              ).map(({ quantity, expiry_date, ...r }) => {
                void quantity;
                void expiry_date;
                return r;
              });
              setRows(parsed);
              setFilename(file.name);
              try {
                localStorage.setItem(
                  draftKey(warehouse),
                  JSON.stringify({ rows: parsed, filename: file.name }),
                );
              } catch {
                setError(
                  "Preview is ready, but this browser could not save the offline draft. Keep this window open.",
                );
              }
            });
          }}
        />
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            try {
              const draft = JSON.parse(
                localStorage.getItem(draftKey(warehouse)) || "null",
              );
              if (
                !draft ||
                !Array.isArray(draft.rows) ||
                draft.rows.length > 200 ||
                typeof draft.filename !== "string"
              )
                throw Error("No saved draft for this warehouse.");
              setRows(draft.rows);
              setFilename(draft.filename);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Restore saved offline draft
        </Button>
        {rows && (
          <>
            <p className="text-sm">
              {filename}: {rows.length} product rows ready. Quantity changes:
              none.
            </p>
            <ul className="max-h-32 overflow-auto text-xs">
              {rows.slice(0, 20).map((r, i) => (
                <li key={i}>
                  {String(r.name || "Unnamed product")} ·{" "}
                  {String(r.sku || r.barcode || "Store product ID")}
                </li>
              ))}
            </ul>
            <Button
              disabled={!online || busy}
              onClick={() =>
                void act(async () => {
                  if (!online)
                    throw Error("Reconnect before applying changes.");
                  const { data, error } = await createClient().rpc(
                    "import_warehouse_catalog",
                    { p_warehouse: warehouse, p_rows: rows },
                  );
                  if (error) throw error;
                  const res = data as Result;
                  setResult(res);
                  if (!res.skipped) {
                    setRows(null);
                    try {
                      localStorage.removeItem(draftKey(warehouse));
                    } catch {
                      /* The applied metadata remains safe to retry. */
                    }
                  }
                  router.refresh();
                })
              }
            >
              Apply product details to warehouse
            </Button>
          </>
        )}
      </section>
      {!online && (
        <p role="status">
          Offline: review or restore a template now. Sync and apply require a
          connection.
        </p>
      )}
      {last && (
        <section
          aria-live="polite"
          className="rounded border border-border p-3 text-sm"
        >
          {last.error ||
            `${last.created || 0} added · ${last.updated || 0} updated · ${last.skipped || 0} skipped`}
          {last.errors?.map((e, i) => (
            <p key={i} className="mt-1 text-xs">
              Row {e.row} — {e.name}: {errors[e.error] || e.error}
            </p>
          ))}
        </section>
      )}
      {(error || settings.error) && (
        <p role="alert" className="text-danger">
          {error || "Could not load saved sync settings."}
        </p>
      )}
    </DialogContent>
  );
}
