/* eslint-disable @next/next/no-img-element -- Inline document image bytes must remain printable without an image proxy. */
"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import { validateLogo } from "./business-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { toast } from "sonner";
export function DocumentLogoSettings() {
  const { store, can } = useStore(),
    { online } = useOffline(),
    cache = useQueryClient();
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const query = useQuery({
    queryKey: ["document-logo-settings", store.businessId],
    queryFn: async () => {
      const db = createClient();
      const { data, error } = await db
        .from("businesses")
        .select("document_logo_path")
        .eq("id", store.businessId)
        .single();
      if (error) throw error;
      if (!data.document_logo_path) return { path: null, url: null };
      const signed = await db.storage
        .from("document-logos")
        .createSignedUrl(data.document_logo_path, 3600);
      if (signed.error) throw signed.error;
      return { path: data.document_logo_path, url: signed.data.signedUrl };
    },
  });
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  if (!can("owner")) return null;
  async function save(remove = false) {
    if (lock.current || !online || !query.data) return;
    lock.current = true;
    setBusy(true);
    try {
      const db = createClient();
      let path: string | null = null;
      if (!remove && file) {
        await validateLogo(file);
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width * bitmap.height > 25_000_000)
            throw Error("Choose an image smaller than 25 megapixels.");
          const scale = Math.min(
            1,
            1024 / Math.max(bitmap.width, bitmap.height),
          );
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas
            .getContext("2d")!
            .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) =>
                b ? resolve(b) : reject(Error("Could not process image")),
              "image/png",
            ),
          );
          if (blob.size > 1_000_000) throw Error("Choose a smaller image.");
          path = `${store.businessId}/${crypto.randomUUID()}.png`;
          const uploaded = await db.storage
            .from("document-logos")
            .upload(path, blob, { contentType: "image/png", upsert: false });
          if (uploaded.error) throw uploaded.error;
        } finally {
          bitmap.close();
        }
      }
      const result = await db.rpc("set_document_logo", {
        p_business: store.businessId,
        p_path: path,
        p_expected: query.data.path,
      });
      if (result.error) throw result.error;
      if (query.data.path && query.data.path !== path)
        await db.storage.from("document-logos").remove([query.data.path]);
      setFile(null);
      setPreview(null);
      await cache.invalidateQueries({
        queryKey: ["document-logo-settings", store.businessId],
      });
      toast.success(remove ? "Document logo removed" : "Document logo saved");
    } catch (e) {
      toast.error(
        (e as Error).message.includes("LOGO_CHANGED")
          ? "The logo changed elsewhere. Refresh before saving."
          : (e as Error).message || "Could not save document logo",
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>Document logo</CardTitle>
        <CardDescription>
          Used on PDFs, Excel documents and receipts for {store.businessName}.
          Your navigation logo stays separate. CSV files contain text and cannot
          include images.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(preview || query.data?.url) && (
           <img
            src={preview || query.data!.url!}
            alt="Document logo preview"
            className="h-24 max-w-full rounded bg-white object-contain object-left"
          />
        )}
        {query.error && (
          <p role="alert">
            Could not load document logo.{" "}
            <Button onClick={() => query.refetch()}>Retry</Button>
          </p>
        )}
        <label className="block text-sm">
          PNG, JPEG or WebP · maximum 2 MB
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || !online}
            onChange={async (e) => {
              const next = e.target.files?.[0];
              if (next) {
                try {
                  await validateLogo(next);
                  setFile(next);
                  setPreview(URL.createObjectURL(next));
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!file || busy || !online || !query.data}
            onClick={() => save()}
          >
            Save document logo
          </Button>
          {file && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setFile(null);
                setPreview(null);
              }}
            >
              Cancel preview
            </Button>
          )}
          {query.data?.path && (
            <Button
              variant="secondary"
              disabled={busy || !online}
              onClick={() => save(true)}
            >
              Remove document logo
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
