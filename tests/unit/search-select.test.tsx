import { expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SearchSelect } from "@/components/ui/search-select";
it("filters currency choices and selects with the keyboard", () => {
  const choose = vi.fn();
  render(
    <SearchSelect
      label="Currency"
      options={[
        { id: "ZAR", label: "ZAR – South Africa" },
        { id: "USD", label: "USD – United States" },
      ]}
      value="ZAR"
      onChange={choose}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "United" } });
  expect(
    screen.queryByRole("option", { name: /South Africa/ }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(choose).toHaveBeenCalledWith("USD");
  expect(input).toHaveAttribute("aria-expanded", "false");
  cleanup();
});
