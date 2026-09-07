import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReturnsConsole } from "@/features/billing/returns-console";
const mocks = vi.hoisted(() => ({
  available: 750,
  refund: true,
  run: vi.fn(),
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({
    store: { id: "store", businessId: "business" },
    currency: "ZAR",
    can: () => true,
  }),
}));
vi.mock("@/features/billing/use-billing-action", () => ({
  useBillingAction: () => ({
    online: true,
    busy: false,
    request: () => "request",
    run: mocks.run,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[1] === "returns"
        ? [
            {
              id: "one",
              reference: "RETURN-ONE",
              status: "APPROVED",
              amount: 750,
              created_at: "2026-09-07",
            },
            {
              id: "two",
              reference: "RETURN-TWO",
              status: "APPROVED",
              amount: 17,
              created_at: "2026-09-07",
            },
          ]
        : queryKey[1] === "return-access"
          ? { approve: true, refund: mocks.refund }
          : queryKey[1] === "refund-summary"
            ? {
                approved: 750,
                refunded: 750 - mocks.available,
                available: queryKey[3] === "two" ? 17 : mocks.available,
                reference: queryKey[3] === "two" ? "PAY-TWO" : "PAY-ONE",
              }
            : queryKey[1] === "return-detail"
              ? { items: [], refunds: [], dispositions: [] }
              : [],
    isFetching: false,
  }),
}));
beforeEach(() => {
  cleanup();
  mocks.available = 750;
  mocks.refund = true;
  mocks.run.mockReset();
});
it("clears refund fields when switching returns and uses that return's amount/reference", () => {
  render(<ReturnsConsole />);
  fireEvent.click(screen.getByText("RETURN-ONE"));
  fireEvent.change(screen.getByLabelText("Refund amount"), {
    target: { value: "5" },
  });
  fireEvent.change(screen.getByLabelText("Refund reason"), {
    target: { value: "Old reason" },
  });
  fireEvent.change(screen.getByLabelText("Refund payment reference"), {
    target: { value: "Old reference" },
  });
  fireEvent.click(screen.getByText("RETURN-TWO"));
  expect(screen.getByLabelText("Refund amount")).toHaveValue(17);
  expect(screen.getByLabelText("Refund reason")).toHaveValue("");
  expect(screen.getByLabelText("Refund payment reference")).toHaveValue(
    "PAY-TWO",
  );
});
it("removes refund entry after full settlement", () => {
  mocks.available = 0;
  render(<ReturnsConsole />);
  fireEvent.click(screen.getByText("RETURN-ONE"));
  expect(screen.queryByLabelText("Refund amount")).not.toBeInTheDocument();
  expect(screen.getByText(/Fully refunded/)).toBeInTheDocument();
});
it("does not offer refund entry to a user with approval only", () => {
  mocks.refund = false;
  render(<ReturnsConsole />);
  fireEvent.click(screen.getByText("RETURN-ONE"));
  expect(screen.queryByLabelText("Refund amount")).not.toBeInTheDocument();
});
it("blocks an amount above the remaining credit", () => {
  render(<ReturnsConsole />);
  fireEvent.click(screen.getByText("RETURN-ONE"));
  fireEvent.change(screen.getByLabelText("Refund amount"), {
    target: { value: "751" },
  });
  fireEvent.change(screen.getByLabelText("Refund reason"), {
    target: { value: "Refund" },
  });
  expect(screen.getByRole("button", { name: "Record refund" })).toBeDisabled();
});
