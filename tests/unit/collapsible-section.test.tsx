import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
afterEach(cleanup);
function Content() {
  const [value, setValue] = useState("");
  return (
    <input
      aria-label="Selected reference"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
it("collapses recent records while retaining their selection and independent header action", () => {
  render(
    <CollapsibleSection
      title="Recent Orders"
      actions={<button>View invoices</button>}
    >
      <Content />
    </CollapsibleSection>,
  );
  fireEvent.change(screen.getByLabelText("Selected reference"), {
    target: { value: "ORDER-1" },
  });
  const toggle = screen.getByRole("button", { name: "Recent Orders" });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("button", { name: "View invoices" })).toBeTruthy();
  fireEvent.click(toggle);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
    "ORDER-1",
  );
});
