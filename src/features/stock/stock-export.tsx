"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const { store } = useStore();
  const [scope, setScope] = useState("all");
  const query = useQuery({
    queryKey: ["stock-export", store.id, status, search],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("stock_export", {
        p_store: store.id,
        p_status: status,
        p_search: search,
      });
      if (error) throw error;
      return {
        rows: data as Record<string, unknown>[],
        generated: new Date().toISOString(),
      };
    },
  });
  const rows = scope === "page" ? currentRows : (query.data?.rows ?? []);
  const prepared = rows.map((r) => ({
    ...r,
    stock_status: r.is_active ? r.stock_status : "Inactive",
    store: store.name,
    filter: status,
    search,
    generated: query.data?.generated ?? "",
  }));
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
          rows={prepared}
          columns={columns}
          filename={`stock-${status}`}
          module="check_stock"
        />
        <span className="text-sm text-muted-foreground">
          {prepared.length} products selected for export
        </span>
      </div>
      {query.error && scope === "all" ? (
        <p role="alert">
          Could not prepare all matching products. Try a narrower search
          (maximum 5,000 products), or export the current page.
        </p>
      ) : query.isLoading ? (
        <p role="status">Preparing filtered stock...</p>
      ) : !rows.length ? (
        <p>No matching products to export.</p>
      ) : null}
    </div>
  );
}
