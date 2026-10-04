"use client";
import { useStore } from "@/lib/store-context";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductRegisterDialog } from "./product-register-dialog";

export function AddProductButton() {
  const router = useRouter();
  const { canModule } = useStore();
  const [open, setOpen] = React.useState(false);
  if (!canModule("products_edit")) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Add product
      </Button>
      <ProductRegisterDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={() => router.refresh()}
      />
    </>
  );
}
