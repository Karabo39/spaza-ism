import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SaleReceiptPrompt } from "@/features/goods-out/sale-receipt-prompt";
const m = vi.hoisted(() => ({ rpc: vi.fn(), done: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  m.rpc.mockResolvedValue({ error: null });
});
function show() {
  render(
    <SaleReceiptPrompt id="sale-1" total={50} currency="ZAR" onDone={m.done} />,
  );
}
it("requires an explicit receipt choice and does not dismiss on Escape", () => {
  show();
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(m.done).not.toHaveBeenCalled();
});
it("opens the saved receipt for printing and returns to Goods Out", () => {
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue({ opener: window } as unknown as Window);
  show();
  fireEvent.click(screen.getByRole("button", { name: "Print Receipt" }));
  expect(open).toHaveBeenCalledWith(
    "/goods-out/sale-1/receipt?autoprint=1",
    "_blank",
  );
  expect(m.done).toHaveBeenCalledOnce();
});
it("keeps the choice open if the browser blocks the print tab", () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  show();
  fireEvent.click(screen.getByRole("button", { name: "Print Receipt" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "Allow the receipt tab",
  );
  expect(m.done).not.toHaveBeenCalled();
});
it("records declining once before closing", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Don’t Print" }));
  fireEvent.click(screen.getByRole("button", { name: "Don’t Print" }));
  await waitFor(() => expect(m.done).toHaveBeenCalledOnce());
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith("record_receipt_print", {
    p_sale: "sale-1",
    p_action: "DECLINED",
  });
});
it("retains the saved sale and allows retry when recording the choice fails", async () => {
  m.rpc.mockRejectedValueOnce(new Error("offline"));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Don’t Print" }));
  await screen.findByRole("alert");
  expect(m.done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Don’t Print" }));
  await waitFor(() => expect(m.done).toHaveBeenCalledOnce());
});
