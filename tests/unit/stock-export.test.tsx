import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StockExport } from "@/features/stock/stock-export";
const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  manager: true,
  columns: [] as {key:string;label:string}[],
  load: null as null | (() => Promise<Record<string, unknown>[]>),
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ can: () => mock.manager, store: { id: "store", name: "Shop" } }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("@/features/reports/export-button", () => ({
  ExportButton: ({
    loadRows, columns,
  }: {
    columns: {key:string;label:string}[];
    loadRows: () => Promise<Record<string, unknown>[]>;
  }) => {
    mock.load = loadRows; mock.columns = columns;
    return null;
  },
}));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks(); mock.manager = true;
});
it("does not fetch until export is requested, then includes every matching page", async () => {
  mock.rpc
    .mockResolvedValueOnce({
      data: {
        rows: [{ name: "First", is_active: true }],
        next: { id: "next", name: "First" },
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { rows: [{ name: "Second", is_active: true }], next: null },
      error: null,
    });
  render(
    <StockExport
      status="low"
      search="water"
      currentRows={[{ name: "Page item", is_active: true }]}
    />,
  );
  expect(mock.rpc).not.toHaveBeenCalled();
  const rows = await mock.load!();
  expect(rows.map((r) => r.name)).toEqual(["First", "Second"]);
  expect(rows[0]).toMatchObject({
    store: "Shop",
    filter: "low",
    search: "water",
  });
  fireEvent.change(screen.getByLabelText("Export scope"), {
    target: { value: "page" },
  });
  mock.rpc.mockClear();
  expect((await mock.load!())[0].name).toBe("Page item");
  expect(mock.rpc).not.toHaveBeenCalled();
});

it("exports only the four employee columns", () => {
 mock.manager = false;
 render(<StockExport status="all" search="" currentRows={[]} />);
 expect(mock.columns.map((c) => c.key)).toEqual(["name","quantity","stock_status","selling_price"]);
});
