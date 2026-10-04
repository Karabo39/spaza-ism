import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ImportConsole } from "@/features/imports/import-console";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  template: vi.fn(),
  online: true,
  can: true,
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: {
      id: "shop",
      businessId: "business",
      name: "Shop",
      businessName: "Business",
    },
    can: () => mock.can,
  }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: mock.online }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mock.rpc, from: mock.from }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/imports/import-format", () => ({
  importColumns: { products: ["name", "quantity"] },
  importTemplate: mock.template,
  parseImport: () => Promise.resolve([{ name: "Soap", quantity: 3 }]),
}));
vi.mock("@/lib/document-logo", () => ({
  loadDocumentLogo: () => Promise.resolve(null),
}));
beforeEach(() => {
  cleanup();
  mock.rpc.mockReset();
  mock.from.mockReset();
  mock.template.mockReset().mockResolvedValue(new Blob(["workbook"]));
  mock.online = true;
  mock.can = true;
});
it("downloads all matching records across bounded pages and retains store scope", async () => {
  const records = Array.from({ length: 501 }, (_, i) => ({
    id: `p${String(i).padStart(4, "0")}`,
    name: `Product ${i}`,
    store_id: "shop",
  }));
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi
      .fn()
      .mockResolvedValueOnce({ data: records.slice(0, 500), error: null })
      .mockResolvedValueOnce({ data: records.slice(500), error: null }),
  };
  mock.from.mockReturnValue(query);
  const createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:download");
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  try {
    render(<ImportConsole />);
    fireEvent.click(
      screen.getByRole("button", { name: "Download existing records" }),
    );
    await waitFor(() => expect(mock.template).toHaveBeenCalledOnce());
    expect(mock.template.mock.calls[0][1]).toHaveLength(501);
    expect(query.limit.mock.calls).toEqual([[500], [500]]);
    expect(query.eq.mock.calls).toEqual([
      ["store_id", "shop"],
      ["store_id", "shop"],
    ]);
    expect(query.gt).toHaveBeenCalledWith("id", "p0499");
    expect(
      new Set(
        mock.template.mock.calls[0][1].map((row: { id: string }) => row.id),
      ).size,
    ).toBe(501);
  } finally {
    createUrl.mockRestore();
    click.mockRestore();
  }
});
it("requires preview confirmation and reuses the import request after an uncertain response", async () => {
  const preview = {
    ok: true,
    rows: [
      {
        id: "product",
        name: "Soap",
        action: "Create",
        row: 2,
        quantity_before: 0,
        quantity_after: 3,
        input: { name: "Soap", quantity: 3 },
      },
    ],
  };
  mock.rpc
    .mockResolvedValueOnce({ data: preview, error: null })
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ data: preview, error: null });
  render(<ImportConsole />);
  const file = new File(["workbook"], "products.xlsx");
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(1)),
  });
  fireEvent.change(screen.getByLabelText("Choose completed Excel template"), {
    target: { files: [file] },
  });
  const confirm = await screen.findByRole("button", {
    name: "Confirm 1 records",
  });
  expect(mock.rpc.mock.calls).toHaveLength(1);
  expect(mock.rpc.mock.calls[0][1].p_preview).toBe(true);
  fireEvent.click(confirm);
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect((confirm as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(confirm);
  await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(3));
  expect(mock.rpc.mock.calls[1][1].p_request).toBe(
    mock.rpc.mock.calls[2][1].p_request,
  );
});
it("disables file review offline and hides import controls from cashiers", () => {
  mock.online = false;
  const { unmount } = render(<ImportConsole />);
  expect(
    (
      screen.getByLabelText(
        "Choose completed Excel template",
      ) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  unmount();
  mock.can = false;
  render(<ImportConsole />);
  expect(screen.queryByLabelText("Choose completed Excel template")).toBeNull();
});
