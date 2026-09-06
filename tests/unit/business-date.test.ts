import { expect, it } from "vitest";
import {
  businessDate,
  businessDayStart,
  businessDayAfter,
} from "@/lib/business-date";
it("includes the whole South African day across month boundaries", () => {
  expect(businessDate(new Date("2026-09-06T22:01:00Z"))).toBe("2026-09-07");
  expect(new Date(businessDayStart("2026-09-07")).toISOString()).toBe(
    "2026-09-06T22:00:00.000Z",
  );
  expect(businessDayAfter("2026-09-30")).toBe("2026-10-01T00:00:00+02:00");
  expect(() => businessDayStart("2026-02-30")).toThrow("valid report date");
});
