"use client";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { useStore } from "@/lib/store-context";
import type { ImportKind } from "./import-format";
export function ImportLink({ kind }: { kind: ImportKind }) {
  const { can } = useStore();
  return can("manager") ? (
    <Link
      href={`/imports?kind=${kind}`}
      className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm"
    >
      <FileSpreadsheet className="size-4" />
      Import Excel
    </Link>
  ) : null;
}
