"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBillingAction } from "@/features/billing/use-billing-action";
type OnlineProductSettings = {
  available_online: boolean;
  online_description: string | null;
  online_price: number | null;
  online_image_path: string | null;
  online_variant_group: string | null;
  online_variant_name: string | null;
  updated_at: string;
  business_id: string;
  store_id: string;
};
export function ProductOnlineSettings({ id }: { id: string }) {
  const { canModule, store } = useStore();
  const allowed =
    canModule("products_online") && store.locationType !== "warehouse";
  const { data, error } = useQuery({
    queryKey: ["billing", "product-online", id, store.id],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await createClient().rpc(
        "product_online_settings",
        { p_product: id },
      );
      if (error) throw error;
      return data as unknown as OnlineProductSettings;
    },
  });
  const { run, busy } = useBillingAction();
  const [uploading, setUploading] = useState(false),
    [image, setImage] = useState<string | null | undefined>(undefined);
  if (!allowed) return null;
  if (error) return <p role="alert">Unable to load online product settings.</p>;
  if (!data) return <p>Loading online product settings…</p>;
  return (
    <section className="mb-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">Customer online catalogue</h2>
      <p className="mt-1 text-sm text-muted">
        These details apply only to the customer page. Store selling prices and
        POS stock remain shared.
      </p>
      <form
        key={data.updated_at}
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(
            () =>
              createClient().rpc("save_product_online", {
                p_product: id,
                p_expected: data.updated_at,
                p_values: {
                  available_online: f.get("available") === "on",
                  online_description: String(f.get("description")),
                  online_price: String(f.get("price")),
                  online_image_path:
                    image === undefined ? data.online_image_path : image,
                  online_variant_group: String(f.get("group")),
                  online_variant_name: String(f.get("variant")),
                },
              }),
            "Online product details saved",
          );
        }}
      >
        <label className="flex items-center gap-3 sm:col-span-2">
          <input
            name="available"
            type="checkbox"
            defaultChecked={data.available_online}
          />
          Available Online
        </label>
        <label className="sm:col-span-2">
          Online description
          <textarea
            name="description"
            maxLength={4000}
            className="mt-1 min-h-20 w-full rounded-lg border border-border bg-background p-3"
            defaultValue={data.online_description || ""}
          />
        </label>
        <label>
          Online price (optional)
          <Input
            name="price"
            type="number"
            min="0"
            step="0.01"
            defaultValue={data.online_price ?? ""}
          />
          <span className="text-xs text-muted">
            Leave blank to use the existing store selling price.
          </span>
        </label>
        <label>
          Product image
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploading || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (
                file.size > 5242880 ||
                !["image/png", "image/jpeg", "image/webp"].includes(file.type)
              ) {
                toast.error("Use a PNG, JPEG or WebP image up to 5 MB.");
                return;
              }
              setUploading(true);
              try {
                const bitmap = await createImageBitmap(file);
                bitmap.close();
                const extension = {
                  "image/png": "png",
                  "image/jpeg": "jpg",
                  "image/webp": "webp",
                }[file.type];
                const path = `${data.business_id}/${data.store_id}/${id}/${crypto.randomUUID()}.${extension}`;
                const { error } = await createClient()
                  .storage.from("online-product-images")
                  .upload(path, file, {
                    contentType: file.type,
                    upsert: false,
                  });
                if (error) throw error;
                setImage(path);
                toast.success("Image uploaded. Save to use it.");
              } catch {
                toast.error("Unable to upload this image.");
              } finally {
                setUploading(false);
              }
            }}
          />
          {(image === undefined ? data.online_image_path : image) && (
            <span className="text-xs text-muted">
              Image selected{" "}
              <button
                type="button"
                className="ml-2 text-primary underline"
                onClick={() => setImage(null)}
              >
                Remove
              </button>
            </span>
          )}
        </label>
        <label>
          Variant group (optional)
          <Input
            name="group"
            maxLength={150}
            placeholder="e.g. T-shirt"
            defaultValue={data.online_variant_group || ""}
          />
        </label>
        <label>
          Variant name (optional)
          <Input
            name="variant"
            maxLength={150}
            placeholder="e.g. Blue · Medium"
            defaultValue={data.online_variant_name || ""}
          />
        </label>
        <p className="text-xs text-muted sm:col-span-2">
          Each variant uses its own existing product and stock balance.
        </p>
        <Button
          type="submit"
          disabled={busy || uploading}
          className="sm:col-span-2"
        >
          Save online product
        </Button>
      </form>
    </section>
  );
}
