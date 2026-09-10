import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { ProductEditDialog } from "@/features/products/product-edit-dialog";
import { ProductRegisterDialog } from "@/features/products/product-register-dialog";
import type { ProductStock } from "@/lib/db/database.types";
const rpc = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: "product", error: null }),
);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ store: { id: "store" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
    }),
  }),
}));
afterEach(() => {
  cleanup();
  rpc.mockClear();
});
it("loads an existing description and saves a deliberate clear", async () => {
  render(
    <ProductEditDialog
      product={
        {
          id: "product",
          name: "Item",
          description: "Original details",
          cost_price: 1,
          selling_price: 2,
          min_stock_level: 0,
          reorder_level: 0,
          unit: "each",
          track_expiry: false,
          is_active: true,
          quantity: 0,
        } as ProductStock
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
  const field = screen.getByLabelText("Description (optional)");
  expect(field).toHaveValue("Original details");
  expect(field).not.toBeRequired();
  fireEvent.change(field, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "save_product_details",
      expect.objectContaining({
        p_values: expect.objectContaining({ description: null }),
      }),
    ),
  );
});
it("submits a new product and description together", async () => {
  render(<ProductRegisterDialog open onOpenChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Item" },
  });
  const field = screen.getByLabelText("Description (optional)");
  expect(field).toHaveAttribute("maxlength", "1000");
  fireEvent.change(field, { target: { value: "Line one\nLine two" } });
  fireEvent.click(screen.getByRole("button", { name: "Add product" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      "create_product_with_description",
      expect.objectContaining({
        p_description: "Line one\nLine two",
        p_name: "Item",
      }),
    ),
  );
});
