import { beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { LocationProductPicker } from "@/features/operations/product-picker";
import type { ProductStock } from "@/lib/db/database.types";
const mocks = vi.hoisted(() => ({
  loading: false,
  error: null as Error | null,
}));
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ currency: "ZAR" }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      { id: "a", name: "Apples", quantity: 10, unit: "each", selling_price: 2 },
      { id: "b", name: "Bread", quantity: 4, unit: "each", selling_price: 15 },
    ],
    isFetching: mocks.loading,
    error: mocks.error,
  }),
}));
function Demo() {
  const [value, setValue] = useState<ProductStock | null>(null);
  return (
    <>
      <LocationProductPicker
        searchable
        location="store"
        label="Order product"
        value={value}
        onChange={setValue}
      />
      <button onClick={() => setValue(null)}>Add item</button>
      <p data-testid="selected">{value?.id}</p>
    </>
  );
}
beforeEach(() => {
  cleanup();
  mocks.loading = false;
  mocks.error = null;
});
it("uses one searchable input with dropdown and keyboard selection", () => {
  render(<Demo />);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Show products" }));
  expect(screen.getAllByRole("option")).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(screen.getByTestId("selected")).toHaveTextContent("b");
  expect(screen.getByRole("combobox")).toHaveValue("Bread");
  fireEvent.click(screen.getByText("Add item"));
  expect(screen.getByRole("combobox")).toHaveValue("");
});
it("clears selection when text changes and closes results with Escape", () => {
  render(<Demo />);
  fireEvent.click(screen.getByRole("button", { name: "Show products" }));
  fireEvent.click(screen.getByRole("option", { name: /Apples/ }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "Pear" } });
  expect(screen.getByTestId("selected")).toBeEmptyDOMElement();
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
it("does not select stale results while fetching", () => {
  mocks.loading = true;
  render(<Demo />);
  fireEvent.click(screen.getByRole("button", { name: "Show products" }));
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(screen.getByTestId("selected")).toBeEmptyDOMElement();
});
