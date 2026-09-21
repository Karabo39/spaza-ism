import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  StockConfiguration,
  type StockConfigurationValue,
} from "@/features/products/stock-configuration";
afterEach(cleanup);
function Form() {
  const [value, setValue] = useState<StockConfigurationValue>({
    tracking_type: "QUANTITY",
    bulk_enabled: false,
    units_per_pack: "6",
    bulk_unit: "case",
  });
  return <StockConfiguration value={value} onChange={setValue} />;
}
it("configures bulk once on the main product and removes bulk for sales-only", () => {
  render(<Form />);
  expect(screen.queryByLabelText("Units per bulk unit")).toBeNull();
  fireEvent.click(screen.getByLabelText("Yes"));
  expect(screen.getByLabelText("Units per bulk unit")).toHaveValue(6);
  fireEvent.change(screen.getByLabelText("Units per bulk unit"), {
    target: { value: "24" },
  });
  expect(screen.getByLabelText("Units per bulk unit")).toHaveValue(24);
  fireEvent.change(screen.getByLabelText("Stock Tracking Type"), {
    target: { value: "SALES_ONLY" },
  });
  expect(screen.queryByLabelText("Units per bulk unit")).toBeNull();
  fireEvent.change(screen.getByLabelText("Stock Tracking Type"), {
    target: { value: "QUANTITY" },
  });
  expect(screen.getByLabelText("No")).toBeChecked();
});
