import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ExportButton } from "@/features/reports/export-button";

vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ store: { id: "store1", name: "Shop", currency: "ZAR" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("retries an uncertain email with the original rows and idempotency key", async () => {
  const loadRows = vi.fn().mockResolvedValue([{ name: "Milk" }]);
  const send = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", send);
  render(
    <ExportButton
      rows={[]}
      columns={[{ key: "name", label: "Name" }]}
      filename="stock"
      loadRows={loadRows}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Email" }));
  fireEvent.change(screen.getByLabelText("Recipient email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Send report" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send report" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(loadRows).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1].body).toBe(send.mock.calls[1][1].body);
});
