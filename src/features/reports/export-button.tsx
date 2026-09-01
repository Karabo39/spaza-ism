"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}

export function ExportButton({
  rows, columns, filename,
}: {
  rows: Record<string, unknown>[];
  columns: { key: string; label: string }[];
  filename: string;
}) {
  function download() {
    const csv = toCsv(rows, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <Button size="sm" variant="secondary" onClick={download} disabled={rows.length === 0}>
      <Download className="size-4" /> Export CSV
    </Button>
  );
}
