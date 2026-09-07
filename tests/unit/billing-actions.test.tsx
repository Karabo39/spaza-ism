import { beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useBillingAction } from "@/features/billing/use-billing-action";
import { toast } from "sonner";
const mock = vi.hoisted(() => ({ online: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/offline/offline-context", () => ({
  useOffline: () => ({ online: mock.online }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }),
}));
beforeEach(() => {
  cleanup();
  mock.online = true;
  vi.clearAllMocks();
});
it("retains retry identity after an uncertain response and renews after a confirmed payment", async () => {
  const { result } = renderHook(() => useBillingAction());
  const payload = { invoice: "i", amount: 10 };
  const first = result.current.request(payload);
  await act(() =>
    result.current.run(() => Promise.reject(new Error("network")), "Paid"),
  );
  expect(result.current.request(payload)).toBe(first);
  await act(() =>
    result.current.run(() => Promise.resolve({ error: null }), "Paid"),
  );
  expect(result.current.request(payload)).not.toBe(first);
});
it("does not submit billing transactions offline", async () => {
  mock.online = false;
  const { result } = renderHook(() => useBillingAction());
  const action = vi.fn();
  await act(() => result.current.run(action, "Done"));
  expect(action).not.toHaveBeenCalled();
});
it("blocks two submissions before React renders the busy state", async () => {
  const { result } = renderHook(() => useBillingAction());
  let finish!: (value: { error: null }) => void;
  const action = vi.fn(
    () =>
      new Promise<{ error: null }>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    const first = result.current.run(action, "Paid");
    await result.current.run(action, "Paid");
    expect(action).toHaveBeenCalledTimes(1);
    finish({ error: null });
    await first;
  });
  expect(result.current.busy).toBe(false);
});
it("preserves an uncertain refund reference when a different action succeeds", async () => {
  const { result } = renderHook(() => useBillingAction());
  const refund = { return: "one", amount: 5.35 };
  const original = result.current.request(refund);
  await act(() =>
    result.current.run(
      () => Promise.reject(new Error("connection lost")),
      "Refund saved",
    ),
  );
  await act(() =>
    result.current.run(async () => {
      result.current.request({ return: "two", amount: 10 });
      return { error: null };
    }, "Refund saved"),
  );
  expect(result.current.request(refund)).toBe(original);
});
it("does not describe a confirmed save as uncertain when the display refresh fails", async () => {
  const { result } = renderHook(() => useBillingAction());
  await act(() =>
    result.current.run(
      async () => ({ error: null }),
      "Paid",
      () => {
        throw new Error("view failed");
      },
    ),
  );
  expect(toast.error).toHaveBeenCalledWith(
    "Saved successfully. Refresh to see the latest records.",
  );
  expect(result.current.busy).toBe(false);
});
