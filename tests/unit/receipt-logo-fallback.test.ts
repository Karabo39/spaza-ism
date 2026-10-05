// @vitest-environment node
import { it, expect, vi } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { loadReceiptLogo } from "@/lib/receipt-logo";
async function database(
  document: string | null,
  business: string | null,
  format: "png" | "jpeg" | "webp" = "png",
) {
  const bytes = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "#e8134f" },
  })
    [format]()
    .toBuffer();
  const download = vi
    .fn()
    .mockResolvedValue({
      data: new Blob([new Uint8Array(bytes)]),
      error: null,
    });
  const bucket = vi.fn().mockReturnValue({ download });
  const row = {
    single: async () => ({
      data: { document_logo_path: document, logo_path: business },
      error: null,
    }),
  };
  const db = {
    from: () => ({ select: () => ({ eq: () => row }) }),
    storage: { from: bucket },
  } as unknown as SupabaseClient<Database>;
  return { db, bucket, download };
}
it("uses the document logo in preference to the business logo", async () => {
  const { db, bucket, download } = await database(
    "document.png",
    "business.webp",
  );
  const logo = await loadReceiptLogo(db, "business");
  expect(bucket).toHaveBeenCalledWith("document-logos");
  expect(download).toHaveBeenCalledWith("document.png");
  expect(logo?.width).toBe(800);
});
it.each(["jpeg", "webp"] as const)(
  "normalises a %s business fallback to a bounded printable PNG",
  async (format) => {
    const { db, bucket } = await database(null, "business." + format, format);
    const logo = await loadReceiptLogo(db, "business");
    expect(bucket).toHaveBeenCalledWith("business-logos");
    expect(logo?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(logo?.width).toBe(512);
    expect(logo?.height).toBe(256);
  },
);
it("leaves receipts without a logo when neither setting is present", async () => {
  const { db, bucket } = await database(null, null);
  expect(await loadReceiptLogo(db, "business")).toBeNull();
  expect(bucket).not.toHaveBeenCalled();
});
