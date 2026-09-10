"use client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useStore } from "@/lib/store-context";
import { money } from "@/lib/format";
import type { ExportColumn } from "./export-data";
export function ReportTable({
  rows,
  columns,
}: {
  rows: Record<string, unknown>[];
  columns: ExportColumn[];
}) {
  const { currency } = useStore();
  const monetary = (key: string) =>
    /(?:amount|price|cost|value|paid|balance|credit|debit|outstanding|profit|revenue|selling|refund)/i.test(
      key,
    ) && !/(?:quantity|count|percent|reference|method|name|date)/i.test(key);
  if (!rows.length)
    return (
      <p className="rounded-lg border border-border p-6 text-muted">
        No records match this report.
      </p>
    );
  return (
    <Table>
      <THead>
        <TR>
          {columns.map((c) => (
            <TH key={c.key}>{c.label}</TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.map((row, index) => (
          <TR key={String(row.id ?? index)}>
            {columns.map((c) => (
              <TD key={c.key}>
                {row[c.key] === null || row[c.key] === undefined
                  ? "—"
                  : typeof row[c.key] === "number" && monetary(c.key)
                    ? money(
                        row[c.key] as number,
                        typeof row.currency === "string"
                          ? row.currency
                          : currency,
                      )
                    : String(row[c.key])}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
