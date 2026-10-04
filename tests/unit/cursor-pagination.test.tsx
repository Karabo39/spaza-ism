import { expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CursorPagination } from "@/components/ui/cursor-pagination";
vi.mock("@/lib/store-context", () => ({
  useStore: () => ({ store: { id: "test-paging-store" } }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    onClick: () => void;
    prefetch?: boolean;
  }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      aria-label={(rest as Record<string, unknown>)["aria-label"] as string}
    >
      {children}
    </a>
  ),
}));
afterEach(cleanup);
it("walks back exactly one page and keeps filter histories separate", () => {
  const a = { id: "a", name: "A" },
    b = { id: "b", name: "B" };
  const { rerender } = render(
    <CursorPagination
      basePath="/products"
      params={{ q: "tea" }}
      count={20}
      next={a}
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "Next page" }));
  rerender(
    <CursorPagination
      basePath="/products"
      params={{ q: "tea" }}
      count={20}
      current={JSON.stringify(a)}
      next={b}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Previous Page" }).getAttribute("href"),
  ).toBe("/products?q=tea");
  fireEvent.click(screen.getByRole("link", { name: "Next page" }));
  rerender(
    <CursorPagination
      basePath="/products"
      params={{ q: "tea" }}
      count={2}
      current={JSON.stringify(b)}
      next={null}
    />,
  );
  const href = screen
    .getByRole("link", { name: "Previous Page" })
    .getAttribute("href")!;
  expect(new URL(href, "http://localhost").searchParams.get("cursor")).toBe(
    JSON.stringify(a),
  );
  rerender(
    <CursorPagination
      basePath="/products"
      params={{ q: "coffee" }}
      count={2}
      current={JSON.stringify(b)}
      next={null}
    />,
  );
  expect(screen.queryByRole("link", { name: "Previous Page" })).toBeNull();
});
