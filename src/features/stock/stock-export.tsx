"use client";
import { useState } from "react";
import { collectPages, dataPage, type CatalogProduct } from "@/lib/data-pages";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { ExportButton } from "@/features/reports/export-button";
const columns = [
  { key: "name", label: "Product" },
  { key: "category_name", label: "Category" },
  { key: "quantity", label: "In stock" },
  { key: "unit", label: "Unit" },
  { key: "stock_status", label: "Status" },
  { key: "cost_price", label: "Cost" },
  { key: "selling_price", label: "Selling" },
  { key: "stock_value", label: "Stock value" },
  { key: "store", label: "Store" },
  { key: "filter", label: "Filter" },
  { key: "search", label: "Search" },
  { key: "generated", label: "Generated" },
];
export function StockExport({
  status,
  search,
  currentRows,
}: {
  status: string;
  search: string;
  currentRows: Record<string, unknown>[];
}) {
  const { store, can } = useStore();
  const [scope, setScope] = useState("all");
  const prepare = (rows: Record<string, unknown>[]) =>
    rows.map((r) => ({
      ...r,
      quantity:
        r.tracking_type === "SALES_ONLY"
          ? "N/A – Sales Tracked Only"
          : r.quantity,
      stock_status: r.is_active ? r.stock_status : "Inactive",
      store: store.name,
      filter: status,
      search,
      generated: new Date().toISOString(),
    }));
  const loadRows = async () => {
    if (scope === "page") return prepare(currentRows);
    return prepare(
      await collectPages<CatalogProduct>(async (after) => {
        const { data, error } = await createClient().rpc("catalog_page", {
          p_stores: [store.id],
          p_search: search,
          p_status: status,
          p_active: status !== "inactive",
          p_main_only: false,
          p_after: after,
          p_limit: 200,
        });
        if (error) throw error;
        return dataPage<CatalogProduct>(data);
      }),
    );
  };
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Export scope"
          className="rounded border border-border bg-input p-2 text-sm"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="all">All matching products</option>
          <option value="page">Current page only</option>
        </select>
        <ExportButton
          rows={[]}
          loadRows={loadRows}
          columns={can("manager") ? columns : columns.filter((c) => ["name", "quantity", "stock_status", "selling_price"].includes(c.key))}
          filename={`stock-${status}`}
          module="check_stock"
        />
        <span className="text-sm text-muted-foreground">
          {scope === "page"
            ? `${currentRows.length} products on this page`
            : "All matching products will be fetched when requested"}
        </span>
      </div>
    </div>
  );
}
