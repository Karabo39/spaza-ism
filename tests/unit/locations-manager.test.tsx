import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocationsManager } from "@/features/settings/locations-manager";

const mocks = vi.hoisted(() => ({ owner: true, online: true, rpc: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/offline/offline-context", () => ({ useOffline: () => ({ online: mocks.online }) }));
vi.mock("@/lib/store-context", () => ({ useStore: () => ({
  store: { id: "shop", businessId: "business" }, stores: [], can: () => mocks.owner,
}) }));

describe("location creation", () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.owner = true; mocks.online = true; mocks.rpc.mockResolvedValue({ data: "warehouse", error: null }); });
  it("creates a warehouse through the audited RPC and refreshes available locations", async () => {
    render(<LocationsManager />);
    fireEvent.change(screen.getByLabelText("New location name"), { target: { value: "Central warehouse" } });
    fireEvent.change(screen.getByLabelText("Location type"), { target: { value: "warehouse" } });
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_location", {
      p_business: "business", p_name: "Central warehouse", p_type: "warehouse", p_code: "",
    }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("does not expose creation controls to a manager", () => {
    mocks.owner = false;
    render(<LocationsManager />);
    expect(screen.queryByRole("button", { name: "Add location" })).toBeNull();
  });
  it("cannot queue a location creation offline", () => {
    mocks.online = false;
    render(<LocationsManager />);
    fireEvent.change(screen.getByLabelText("New location name"), { target: { value: "Warehouse" } });
    expect((screen.getByRole("button", { name: "Add location" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add location" }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
