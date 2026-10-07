"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/format";
import { useOffline } from "@/lib/offline/offline-context";
import { useStore } from "@/lib/store-context";

export function ProductDeleteButton({
  productId,
  productName,
  active,
}: {
  productId: string;
  productName: string;
  active: boolean;
}) {
  const router = useRouter();
  const { canModule } = useStore();
  const { online } = useOffline();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!canModule("products_manage") || !active) return null;

  async function remove() {
    setBusy(true);
    try {
      const { error } = await createClient().rpc("archive_product", {
        p_product: productId,
      });
      if (error) {
        toast.error(friendlyError(error.message));
        return;
      }
      toast.success("Product removed from the active catalogue. Historical records are preserved.");
      setOpen(false);
      router.replace("/products");
      router.refresh();
    } catch {
      toast.error("Could not confirm the product change. Refresh and check its current status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" /> Delete
      </Button>
      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete product from the active catalogue?</DialogTitle>
            <DialogDescription>
              <strong>{productName}</strong> will no longer be available for new sales. The product record and all historical sales, invoices, orders, and stock movements will be retained.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted">
            Products with non-expired stock, active online orders, unfinished stock transfers, or bulk-product links cannot be deleted. A product with only expired stock may be removed; its stock and audit history remain recorded.
          </p>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Keep product
            </Button>
            <Button variant="danger" loading={busy} disabled={!online} onClick={() => void remove()}>
              Confirm delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
