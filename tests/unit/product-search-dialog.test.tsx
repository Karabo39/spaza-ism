import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { ProductSearchDialog } from "@/features/scan/product-search-dialog";
import { CustomerPicker } from "@/features/credit/customer-picker";
const lookup = vi.hoisted(() => vi.fn(async () => []));
const customers = vi.hoisted(() => vi.fn(async () => ({ data: [], error: null })));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const chain = { select: () => chain, eq: () => chain, ilike: () => chain, order: () => chain, limit: customers };
  return { from: () => chain };
} }));
vi.mock("@/features/scan/lookup", () => ({ searchProducts: lookup }));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ store: { id: "store" }, currency: "ZAR" }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  lookup.mockClear();
  customers.mockClear();
});
it("reduces four customer keystrokes to one request and preserves the new-customer form", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><CustomerPicker open onOpenChange={vi.fn()} onSelect={vi.fn()} /></QueryClientProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  customers.mockClear();
  for (const value of ["j", "jo", "joh", "john"]) {
    fireEvent.change(screen.getByPlaceholderText(/Search customers/), { target: { value } });
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
  }
  expect(customers).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(customers).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "New customer" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "John" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("John");
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.useRealTimers();
});
it("still runs the offline-aware product lookup without a connection", async () => {
  onlineManager.setOnline(false);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><ProductSearchDialog open onOpenChange={vi.fn()} onPick={vi.fn()} /></QueryClientProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(lookup).toHaveBeenCalledWith("store", "");
});
it("coalesces a typing burst into one search and resets on reopening", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const props = { onOpenChange: vi.fn(), onPick: vi.fn() };
  const view = (open: boolean) => (
    <QueryClientProvider client={client}>
      <ProductSearchDialog open={open} {...props} />
    </QueryClientProvider>
  );
  const { rerender } = render(view(true));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  lookup.mockClear();
  const input = screen.getByPlaceholderText(/Search by name/);
  for (const value of ["m", "mi", "mil", "milk"]) {
    fireEvent.change(input, { target: { value } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
  }
  expect(lookup).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(lookup).toHaveBeenLastCalledWith("store", "milk");
  rerender(view(false));
  rerender(view(true));
  expect(
    (screen.getByPlaceholderText(/Search by name/) as HTMLInputElement).value,
  ).toBe("");
});
