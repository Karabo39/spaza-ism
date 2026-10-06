"use client";
import Image from "next/image";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { useBillingAction } from "@/features/billing/use-billing-action";
import type { OnlineSettings } from "./types";

export function OnlineOrderingButton() {
  const { store, canModule } = useStore();
  const [open, setOpen] = useState(false);
  if (
    !canModule("orders_online_settings") ||
    store.locationType === "warehouse"
  )
    return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Online Order Access</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Online Order Access · {store.name}</DialogTitle>
          <DialogDescription>
            Share this store&apos;s link or QR code. Only products marked
            Available Online are visible.
          </DialogDescription>
          {open && <Settings key={store.id} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
function Settings() {
  const { store } = useStore();
  const { busy, run } = useBillingAction();
  const [qr, setQr] = useState("");
  const { data, error } = useQuery({
    queryKey: ["billing", "online-settings", store.id],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("online_settings", {
        p_store: store.id,
      });
      if (error) throw error;
      return data as unknown as OnlineSettings;
    },
  });
  if (error)
    return <p role="alert">Unable to load online ordering settings.</p>;
  if (!data) return <p>Loading settings…</p>;
  const url = `https://posinventory.shop/shop/${data.link_token}`;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-4">
        <p className="text-xs text-muted">Customer ordering link</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block break-all text-primary underline"
        >
          {url}
        </a>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              navigator.clipboard
                .writeText(url)
                .then(() => toast.success("Link copied"))
                .catch(() => toast.error("Copy the link above"))
            }
          >
            Copy link
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const QR = await import("qrcode");
              setQr(
                await QR.toDataURL(url, {
                  width: 512,
                  margin: 3,
                  errorCorrectionLevel: "M",
                }),
              );
            }}
          >
            Generate QR code
          </Button>
        </div>
        {qr && (
          <div className="mt-4">
            <Image
              src={qr}
              alt={`Customer ordering QR for ${store.name}`}
              width={192}
              height={192}
              unoptimized
              className="size-48 bg-white"
            />
            <a
              href={qr}
              download={`online-ordering-${store.id}.png`}
              className="mt-2 inline-block text-primary underline"
            >
              Download QR code
            </a>
          </div>
        )}
      </div>
      <form
        key={data.version}
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(
            () =>
              createClient().rpc("save_online_ordering_settings", {
                p_store: store.id,
                p_expected: data.version,
                p_values: {
                  enabled: f.get("enabled") === "on",
                  collection_enabled: f.get("collection") === "on",
                  delivery_enabled: f.get("delivery") === "on",
                  pay_on_collection: f.get("pay_on_collection") === "on",
                  delivery_fee: Number(f.get("fee")),
                  payment_instructions: String(f.get("instructions")),
                  reservation_hours: Number(f.get("hours")),
                  notifications_enabled: f.get("notifications") === "on",
                },
              }),
            "Online ordering settings saved",
          );
        }}
      >
        <label className="flex items-center gap-3 sm:col-span-2">
          <input name="enabled" type="checkbox" defaultChecked={data.enabled} />
          Enable this store&apos;s customer page
        </label>
        <label className="flex items-center gap-3">
          <input
            name="collection"
            type="checkbox"
            defaultChecked={data.collection_enabled}
          />
          Allow collection
        </label>
        <label className="flex items-center gap-3">
          <input
            name="delivery"
            type="checkbox"
            defaultChecked={data.delivery_enabled}
          />
          Allow delivery
        </label>
        <label className="flex items-center gap-3 sm:col-span-2">
          <input
            name="pay_on_collection"
            type="checkbox"
            defaultChecked={data.pay_on_collection}
          />
          Allow payment on collection
        </label>
        <label>
          Standard online delivery fee
          <Input
            name="fee"
            type="number"
            min="0"
            step="0.01"
            required
            defaultValue={data.delivery_fee}
          />
        </label>
        <label>
          Bank-transfer reservation (hours)
          <Input
            name="hours"
            type="number"
            min="1"
            max="72"
            step="1"
            required
            defaultValue={data.reservation_hours}
          />
        </label>
        <label className="sm:col-span-2">
          Payment instructions / bank details
          <textarea
            name="instructions"
            className="mt-1 min-h-28 w-full rounded-lg border border-border bg-background p-3"
            maxLength={4000}
            defaultValue={data.payment_instructions}
          />
        </label>
        <label className="flex items-center gap-3 sm:col-span-2">
          <input
            name="notifications"
            type="checkbox"
            defaultChecked={data.notifications_enabled}
          />
          Send updates to customers who opt in to email
        </label>
        <p className="text-xs text-muted sm:col-span-2">
          Bank transfers must be verified by staff. Unpaid reservations expire
          automatically. Existing store selling prices remain unchanged; an
          optional online price is separate.
        </p>
        <Button type="submit" disabled={busy} className="sm:col-span-2">
          Save settings
        </Button>
      </form>
    </div>
  );
}
