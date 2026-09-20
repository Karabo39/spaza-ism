"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LocationsManager } from "@/features/settings/locations-manager";
import { useStore } from "@/lib/store-context";
export function AddStoreButton() {
  const [open, setOpen] = useState(false);
  const { can } = useStore();
  if (!can("owner")) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Store</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Add Store</DialogTitle>
          <DialogDescription>
            Create a store with its own stock and staff access.
          </DialogDescription>
          <LocationsManager activateOnCreate />
        </DialogContent>
      </Dialog>
    </>
  );
}
