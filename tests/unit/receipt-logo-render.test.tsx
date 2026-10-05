import React from "react";
import Image from "next/image";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import ReceiptPage from "@/app/(app)/goods-out/[id]/receipt/page";
vi.mock("@/lib/session", () => ({
  getSession: async () => ({
    activeStore: { id: "store", businessId: "business" },
  }),
}));
vi.mock("@/features/goods-out/receipt-customer", () => ({
  receiptCustomer: async () => null,
}));
vi.mock("@/features/goods-out/sale-print-actions", () => ({
  SalePrintActions: () => null,
}));
vi.mock("@/components/document-logo", () => ({
  DocumentLogo: async () => {
    await Promise.resolve();
    return (
      <Image
        src="data:image/png;base64,logo"
        alt="Business logo"
        width={120}
        height={40}
        unoptimized
      />
    );
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const result =
        table === "sale_receipts"
          ? {
              data: {
                snapshot: {
                  business: "Shop",
                  store: "Branch",
                  reference: "POS-1",
                  created_at: "2026-10-05T12:00:00Z",
                  status: "PAID",
                  cashier: "Cashier",
                  currency: "ZAR",
                  items: [],
                  payments: [],
                  discount: 0,
                  tax: 0,
                  total: 10,
                },
              },
              error: null,
            }
          : table === "receipt_preferences"
            ? { data: { paper_format: "80mm" }, error: null }
            : { data: [], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => result,
        maybeSingle: async () => result,
      };
      return chain;
    },
  }),
}));
it("includes an asynchronously loaded logo inside the initial printable receipt HTML", async () => {
  const html = renderToStaticMarkup(
    await ReceiptPage({
      params: Promise.resolve({ id: "sale" }),
      searchParams: Promise.resolve({}),
    }),
  );
  const article = html.slice(
    html.indexOf("<article"),
    html.indexOf("</article>"),
  );
  expect(article).toContain("data:image/png;base64,logo");
  expect(article).toContain("Business logo");
  expect(article).toContain("Sales receipt");
});
