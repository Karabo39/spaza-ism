import { beforeEach, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { CustomerEmails } from "@/features/credit/customer-emails";
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  query: vi.fn(),
  refetch: vi.fn(async () => ({})),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: true }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (args: unknown) => {
    m.query(args);
    return { data: [], refetch: m.refetch };
  },
}));
beforeEach(() => {
  cleanup();
  m.rpc.mockReset().mockResolvedValue({ data: "queued", error: null });
  m.query.mockClear();
});
it("loads history only when expanded and never sends on page load", () => {
  render(<CustomerEmails customerId="customer" enabled />);
  expect(m.query.mock.calls[0][0].enabled).toBe(false);
  expect(m.rpc).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: /Customer email notifications/ }),
  );
  expect(m.query.mock.lastCall?.[0].enabled).toBe(true);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("requires customer notifications before generating statements", () => {
  render(<CustomerEmails customerId="customer" enabled={false} />);
  fireEvent.click(
    screen.getByRole("button", { name: /Customer email notifications/ }),
  );
  expect(
    screen.getByRole("button", { name: "Generate & email statement" }),
  ).toBeDisabled();
});
it("keeps the same request ID on repeated clicks for an unchanged statement", async () => {
  render(<CustomerEmails customerId="customer" enabled />);
  fireEvent.click(
    screen.getByRole("button", { name: /Customer email notifications/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Generate & email statement" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Statement generated"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Generate & email statement" }),
  );
  await waitFor(() => expect(m.rpc).toHaveBeenCalledTimes(2));
  expect(m.rpc.mock.calls[0]).toEqual(m.rpc.mock.calls[1]);
});
