import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Page from "@/app/accept-invitation/page";
const mock = vi.hoisted(() => ({
  verify: vi.fn(),
  update: vi.fn(),
  rpc: vi.fn(),
  password: true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      verifyOtp: mock.verify,
      updateUser: mock.update,
      getUser: async () => ({ data: { user: { id: "employee" } } }),
      signOut: vi.fn(),
    },
    rpc: mock.rpc,
  }),
}));
beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
  mock.password = true;
  history.replaceState(
    null,
    "",
    "/accept-invitation#id=10000000-0000-4000-8000-000000000001&secret=" +
      "a".repeat(64) +
      "&token_hash=private-token&type=invite",
  );
  mock.verify.mockResolvedValue({ error: null });
  mock.update.mockResolvedValue({ error: null });
  mock.rpc.mockImplementation(async (name: string) => ({
    error: null,
    data:
      name === "employee_invitation_details"
        ? {
            email: "employee@test.invalid",
            business: "Shop",
            role: "employee",
            state: "PENDING",
            first_name: "",
            surname: "",
            phone: "",
            needs_password: mock.password,
            assignments: { store: { goods_out: true } },
            stores: { store: "Main store" },
          }
        : null,
  }));
});
it("does not consume a link just because an email scanner opens the page", async () => {
  render(<Page />);
  await screen.findByRole("button", { name: "Confirm email and continue" });
  expect(mock.verify).not.toHaveBeenCalled();
  expect(location.hash).toBe("");
});
it("locks email and saves the employee's own password before activating membership", async () => {
  render(<Page />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm email and continue" }),
  );
  const email = await screen.findByLabelText("Email address");
  expect(email).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText("First name(s)"), {
    target: { value: "Jane" },
  });
  fireEvent.change(screen.getByLabelText("Surname"), {
    target: { value: "Example" },
  });
  fireEvent.change(screen.getByLabelText("Phone number"), {
    target: { value: "0711234567" },
  });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: "test-password" },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: "test-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByText("Your account is ready");
  expect(mock.update).toHaveBeenCalledWith({ password: "test-password" });
  expect(mock.rpc).toHaveBeenLastCalledWith(
    "accept_employee_invitation",
    expect.objectContaining({
      p_first_name: "Jane",
      p_surname: "Example",
      p_phone: "0711234567",
    }),
  );
  expect(mock.update.mock.invocationCallOrder[0]).toBeLessThan(
    mock.rpc.mock.invocationCallOrder[1],
  );
  expect(sessionStorage.getItem("pos-employee-invitation")).toBeNull();
});
it("keeps existing passwords and allows retry after interrupted activation", async () => {
  mock.password = false;
  render(<Page />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm email and continue" }),
  );
  await screen.findByLabelText("Email address");
  expect(
    screen.queryByLabelText("Password", { exact: true }),
  ).not.toBeInTheDocument();
  for (const [label, value] of [
    ["First name(s)", "Jane"],
    ["Surname", "Example"],
    ["Phone number", "0711234567"],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  mock.rpc.mockResolvedValueOnce({
    error: { message: "connection lost" },
    data: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await screen.findByRole("alert");
  expect(sessionStorage.getItem("pos-employee-invitation")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await waitFor(() =>
    expect(screen.getByText("Your account is ready")).toBeInTheDocument(),
  );
  expect(mock.update).not.toHaveBeenCalled();
  await act(async () => {});
});
