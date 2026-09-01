"use client";
import * as React from "react";
import { toast } from "sonner";
import { ClipboardCopy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { qty } from "@/lib/format";

export function RestockListButton({ items }: { items: { name: string; qty: number; supplier: string | null }[] }) {
  async function copy() {
    const lines = items.map((i) => `- ${i.name}: ${qty(i.qty)}${i.supplier ? ` (${i.supplier})` : ""}`);
    const text = `Restock list\n${lines.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Restock list copied to clipboard");
    } catch {
      toast.error("Could not copy — your browser blocked clipboard access");
    }
  }
  return <Button size="sm" variant="secondary" onClick={copy}><ClipboardCopy className="size-4" /> Copy restock list</Button>;
}
