// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
import { validateLogo } from "@/features/settings/business-logo";
it("accepts a PNG signature and rejects mismatched or oversized logo files", async () => {
  await expect(
    validateLogo(
      new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])],
        "logo.png",
        { type: "image/png" },
      ),
    ),
  ).resolves.toBe("png");
  await expect(
    validateLogo(new File(["<svg>"], "logo.png", { type: "image/png" })),
  ).rejects.toThrow("contents");
  await expect(
    validateLogo(new File(["<svg>"], "logo.svg", { type: "image/svg+xml" })),
  ).rejects.toThrow("PNG, JPEG");
  await expect(
    validateLogo(
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], "logo.png", {
        type: "image/png",
      }),
    ),
  ).rejects.toThrow("2 MB");
});
