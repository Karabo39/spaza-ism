import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SalePrintActions } from "@/features/goods-out/sale-print-actions";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/features/billing/print-receipt", () => ({ PrintReceipt: ({ onPrint }: { onPrint: () => void }) => <button onClick={onPrint}>Print</button> }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); mocks.rpc.mockReset(); });
describe("receipt printing", () => {
 it("requests the store copy after the configured delay without creating sales", async () => {
  vi.useFakeTimers(); mocks.rpc.mockResolvedValue({ error: null }); const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<SalePrintActions id="saved-sale" secondCopy delay={3} />);
  await act(async () => { fireEvent.click(screen.getByText("Print")); });
  expect(print).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2999); }); expect(print).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(print).toHaveBeenCalledTimes(2);
  expect(mocks.rpc.mock.calls.map(c => c[0])).toEqual(["record_receipt_print", "record_receipt_print"]);
  expect(mocks.rpc.mock.calls[1][1]).toEqual({ p_sale: "saved-sale", p_action: "COPY_REQUESTED" });
 });
 it("does not print if recording the request fails", async () => {
  mocks.rpc.mockResolvedValue({ error: { message: "FORBIDDEN" } }); const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<SalePrintActions id="saved-sale" secondCopy={false} delay={3} />);
  await act(async () => { fireEvent.click(screen.getByText("Print")); }); expect(print).not.toHaveBeenCalled();
 });
});
