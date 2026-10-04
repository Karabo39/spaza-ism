import { afterEach, expect, it, vi } from "vitest";
import { printDocument } from "@/lib/print-document";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("prints only the receipt in a sandboxed frame and removes it after closing", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      text: async () =>
        '<html><body><nav>Application menu</nav><article id="receipt"><h1>Invoice 123</h1><script>window.bad=true</script></article></body></html>',
    });
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(window, "focus").mockImplementation(() => {});
  const append = document.body.append.bind(document.body);
  let printed = "";
  let sandbox = "";
  vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
    append(...nodes);
    const frame = nodes[0] as HTMLIFrameElement;
    const win = frame.contentWindow!;
    Object.defineProperty(frame.contentDocument!, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    vi.spyOn(win, "focus").mockImplementation(() => {});
    vi.spyOn(win, "print").mockImplementation(() => {
      printed = frame.contentDocument!.body.innerHTML;
      sandbox = frame.getAttribute("sandbox")!;
      win.dispatchEvent(new Event("afterprint"));
    });
  });
  const before = window.location.href;
  await printDocument("/invoices/123/receipt");
  expect(printed).toContain("Invoice 123");
  expect(printed).not.toContain("Application menu");
  expect(printed).not.toContain("<script");
  expect(sandbox).toBe("allow-same-origin allow-modals");
  expect(document.querySelector("iframe")).toBeNull();
  expect(window.location.href).toBe(before);
});
it("rejects external print URLs without fetching", async () => {
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  await expect(
    printDocument("https://unrelated.invalid/receipt"),
  ).rejects.toThrow("Invalid print");
  expect(f).not.toHaveBeenCalled();
});
it("clears the print lock and frame when a document cannot be loaded", async () => {
  vi.spyOn(window, "focus").mockImplementation(() => {});
  const f = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", f);
  await expect(printDocument("/bad")).rejects.toThrow("Could not load");
  await expect(printDocument("/retry")).rejects.toThrow("Could not load");
  expect(f).toHaveBeenCalledTimes(2);
  expect(document.querySelector("iframe")).toBeNull();
});
