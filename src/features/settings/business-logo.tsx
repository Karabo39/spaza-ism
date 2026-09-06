"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export function useBusinessLogo() {
  const { store, user } = useStore();
  return useQuery({
    queryKey: ["business-logo", user.id, store.businessId],
    staleTime: 30 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    queryFn: async () => {
      const db = createClient();
      const { data: business, error } = await db
        .from("businesses")
        .select("logo_path")
        .eq("id", store.businessId)
        .single();
      if (error) throw error;
      if (!business.logo_path) return { path: null, url: null };
      const { data, error: storageError } = await db.storage
        .from("business-logos")
        .createSignedUrl(business.logo_path, 3600);
      if (storageError) throw storageError;
      return { path: business.logo_path, url: data.signedUrl };
    },
  });
}
export function BusinessLogo() {
  const { store } = useStore(),
    { data } = useBusinessLogo();
  // Signed private URLs are renewed by the query; no public image host is needed.
  // eslint-disable-next-line @next/next/no-img-element
  return data?.url ? (
    <img
      src={data.url}
      alt={`${store.businessName} logo`}
      className="size-8 shrink-0 rounded-md bg-white object-contain"
    />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
      <ShieldCheck className="size-4" />
    </span>
  );
}
export async function validateLogo(
  file: File,
): Promise<"png" | "jpg" | "webp"> {
  const types: Record<string, "png" | "jpg" | "webp"> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const extension = types[file.type];
  if (!extension || file.size > 2 * 1024 * 1024 || file.size === 0)
    throw new Error("Choose a PNG, JPEG or WebP image up to 2 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const valid =
    extension === "png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
      : extension === "jpg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
          String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!valid) throw new Error("The image contents do not match the file type.");
  return extension;
}
export function BusinessLogoSettings() {
  const { store, can } = useStore(),
    { online } = useOffline(),
    { data, error } = useBusinessLogo(),
    cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    input = useRef<HTMLInputElement>(null);
  if (!can("owner")) return null;
  async function update(file: File | null) {
    if (!online || busy) return;
    setBusy(true);
    try {
      const db = createClient();
      let path: string | null = null;
      if (file) {
        const extension = await validateLogo(file);
        path = `${store.businessId}/${crypto.randomUUID()}.${extension}`;
        const uploaded = await db.storage
          .from("business-logos")
          .upload(path, file, {
            upsert: false,
            contentType: file.type,
            cacheControl: "3600",
          });
        if (uploaded.error) throw uploaded.error;
      }
      const saved = await db.rpc("set_business_logo", {
        p_business: store.businessId,
        p_path: path,
      });
      if (saved.error) throw saved.error;
      // Never remove the newly uploaded object after an uncertain save; it may be current.
      if (data?.path && data.path !== path)
        await db.storage.from("business-logos").remove([data.path]);
      await cache.invalidateQueries({ queryKey: ["business-logo"] });
      toast.success(file ? "Business logo updated." : "Business logo removed.");
      if (input.current) input.current.value = "";
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the logo. Refresh and check the current logo before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>Business logo</CardTitle>
        <CardDescription>
          Shown in the top-left navigation for every location in{" "}
          {store.businessName}. Owners can upload or remove it while online.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-3">
          <BusinessLogo />
          <span className="text-sm">{store.businessName}</span>
        </div>
        {error && (
          <p role="alert" className="mb-3 text-sm text-danger">
            Could not load the logo. Check the Storage setup and try again.
          </p>
        )}
        <label className="block text-sm">
          PNG, JPEG or WebP · maximum 2 MB
          <Input
            ref={input}
            className="mt-2 max-w-lg"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || !online}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void update(file);
            }}
          />
        </label>
        {data?.path && (
          <Button
            className="mt-3"
            variant="secondary"
            disabled={!online || busy}
            onClick={() => update(null)}
          >
            Remove logo
          </Button>
        )}
        {busy && (
          <p className="mt-2 text-sm" role="status">
            Saving logo…
          </p>
        )}
      </CardContent>
    </Card>
  );
}
