import { describe, it, expect } from "vitest";
import { activeSellingStore } from "@/lib/location-scope";
import type { SessionStore } from "@/lib/session";
const store = (id: string, type: string, businessId = "biz") =>
  ({
    id,
    locationType: type,
    businessId,
    modules: { warehouse: true, check_stock: true },
  }) as SessionStore;
describe("selling store context", () => {
  it("never uses a warehouse cookie for store screens when a selling store is assigned", () => {
    expect(
      activeSellingStore(
        [store("wh", "warehouse"), store("shop", "store")],
        "wh",
      )?.id,
    ).toBe("shop");
  });
  it("preserves the user's selected selling store", () => {
    expect(
      activeSellingStore([store("a", "store"), store("b", "store")], "b")?.id,
    ).toBe("b");
  });
  it("returns to a selling store in the same business", () => {
    expect(
      activeSellingStore(
        [
          store("a", "store", "other"),
          store("wh", "warehouse"),
          store("b", "store"),
        ],
        "wh",
      )?.id,
    ).toBe("b");
  });
});
