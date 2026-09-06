import { beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PasswordRecovery } from "@/features/auth/password-recovery";
import { safeAuthPath } from "@/lib/auth-redirect";
const mock = vi.hoisted(() => ({
  reset: vi.fn(),
  update: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { resetPasswordForEmail: mock.reset, updateUser: mock.update },
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mock.replace, refresh: vi.fn() }),
}));
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mock.reset.mockResolvedValue({ error: null });
  mock.update.mockResolvedValue({ error: null });
});
it("sends a recovery request to the app callback without revealing account existence", async () => {
  render(<PasswordRecovery />);
  fireEvent.change(screen.getByLabelText("Account email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  await screen.findByRole("status");
  expect(mock.reset).toHaveBeenCalledWith("owner@example.test", {
    redirectTo: expect.stringContaining("/auth/callback?next=/reset-password"),
  });
});
it("updates a matching new password through the authenticated provider", async () => {
  render(<PasswordRecovery reset />);
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "new-test-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "new-test-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save new password" }));
  await waitFor(() =>
    expect(mock.update).toHaveBeenCalledWith({ password: "new-test-password" }),
  );
  expect(mock.replace).toHaveBeenCalledWith("/");
});
it("only allows internal post-login destinations", () => {
  for (const path of [
    "https://example.test",
    "//example.test",
    "/\\example.test",
    "/\n/example.test",
  ])
    expect(safeAuthPath(path)).toBe("/");
  expect(safeAuthPath("/reset-password")).toBe("/reset-password");
  expect(safeAuthPath("/reports?from=2026-09-01")).toBe(
    "/reports?from=2026-09-01",
  );
});
