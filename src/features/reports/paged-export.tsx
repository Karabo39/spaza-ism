"use client";
import { createClient } from "@/lib/supabase/client";
import {
  collectPages,
  dataPage,
  type CatalogProduct,
  type Cursor,
} from "@/lib/data-pages";
import { ExportButton } from "./export-button";
import { activityExportRow, type ActivityRow } from "./activity-data";

import type { ExportColumn } from "./export-data";

export function ActivityExport({
  kind,
  scope,
  from,
  to,
  columns,
  filename,
}: {
  kind: "audit" | "movements" | "sales";
  scope: string;
  from?: string;
  to?: string;
  columns: ExportColumn[];
  filename: string;
}) {
  return (
    <ExportButton
      rows={[]}
      columns={columns}
      filename={filename}
      loadRows={async () => {
        const rows = await collectPages<ActivityRow>(
          async (after: Cursor | null) => {
            const { data, error } = await createClient().rpc("activity_page", {
              p_kind: kind,
              p_scope: scope,
              p_from: from ?? null,
              p_to: to ?? null,
              p_after: after,
              p_limit: 200,
              p_details: kind === "audit",
            });
            if (error) throw error;
            return dataPage<ActivityRow>(data);
          },
        );
        return rows.map((r) => activityExportRow(kind, r));
      }}
    />
  );
}
export function CatalogExport({
  stores,
  search = "",
  status = "all",
  active = null,
  mainOnly = true,
  columns,
  filename,
  locations,
}: {
  stores: string[];
  search?: string;
  status?: string;
  active?: boolean | null;
  mainOnly?: boolean;
  columns: ExportColumn[];
  filename: string;
  locations?: { id: string; name: string; currency: string }[];
}) {
  return (
    <ExportButton
      rows={[]}
      columns={columns}
      filename={filename}
      loadRows={async () => {
        const rows = await collectPages<CatalogProduct>(async (after) => {
          const { data, error } = await createClient().rpc("catalog_page", {
            p_stores: stores,
            p_search: search,
            p_status: status,
            p_active: active,
            p_main_only: mainOnly,
            p_after: after,
            p_limit: 200,
          });
          if (error) throw error;
          return dataPage<CatalogProduct>(data);
        });
        return rows.map((r) => ({
          ...r,
          quantity:
            r.tracking_type === "SALES_ONLY"
              ? "N/A – Sales Tracked Only"
              : r.quantity,
          bulk_stock: (r.bulk_options ?? [])
            .map((b) => `${b.quantity} ${b.unit} × ${b.units_per_pack}`)
            .join(", "),
          tracking:
            r.tracking_type === "SALES_ONLY"
              ? "Sales Tracked Only"
              : "Quantity Tracked",
          location: locations?.find((l) => l.id === r.store_id)?.name,
          currency: locations?.find((l) => l.id === r.store_id)?.currency,
        }));
      }}
    />
  );
}
