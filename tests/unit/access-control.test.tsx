import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PermissionEditor } from "@/features/users/access-control";
const mock = vi.hoisted(() => ({ storeId: "store-a", rpc: vi.fn(), online: true }));
vi.mock("@/lib/store-context", () => ({ useStore: () => ({ store: { id: mock.storeId, name: "Shop A" } }) }));
vi.mock("@/lib/offline/offline-context", () => ({ useOffline: () => ({ online: mock.online }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mock.rpc }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const member = { id: "membership", name: "Cashier", role: "employee" as const, assigned: true, active: true, permissions: {}, version: 3 };
describe("Access Control editor", () => {
  beforeEach(() => { cleanup(); mock.rpc.mockReset(); mock.online = true; mock.rpc.mockResolvedValue({ data: 4, error: null }); });
  it("saves permissions against the selected store and loaded version", async () => {
    render(<PermissionEditor member={member} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Goods Out" }));
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][1]).toMatchObject({ p_store: "store-a", p_membership: "membership", p_expected: 3, p_permissions: { goods_out: false, settings: false, access_control: false } });
    expect(screen.getByRole("checkbox", { name: /Adjust Stock/ })).toBeDisabled();
  });
  it("keeps unsaved choices when a concurrent edit is rejected", async () => {
    mock.rpc.mockResolvedValue({ error: { message: "ACCESS_CHANGED_REFRESH" } });
    render(<PermissionEditor member={member} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Goods Out" }));
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone changed these permissions");
    expect(screen.getByRole("checkbox", { name: "Goods Out" })).not.toBeChecked();
  });
  it("cannot disable owner recovery or save changes offline", () => {
    render(<PermissionEditor member={{ ...member, role: "owner" }} />);
    expect(screen.getByRole("checkbox", { name: "Access Control" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Access Control" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "Save access" })).toBeNull();
    cleanup(); mock.online = false; render(<PermissionEditor member={member} />);
    expect(screen.getByRole("checkbox", { name: "Goods Out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save access" })).toBeDisabled();
  });
});

vi.mock("@/features/users/return-access", () => ({ ReturnAccess: () => null }));
