"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LocationsManager } from "@/features/settings/locations-manager";
import { useStore } from "@/lib/store-context";
export function WarehouseAdd() {
  const [open, setOpen] = useState(false);
  const { can } = useStore();
  if (!can("owner")) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Warehouse</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Warehouse</DialogTitle>
            <DialogDescription>
              Create a warehouse with separate stock.
            </DialogDescription>
          </DialogHeader>
          <LocationsManager locationType="warehouse" />
        </DialogContent>
      </Dialog>
    </>
  );
}
