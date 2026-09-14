import type { SessionStore } from "./session";
export function activeSellingStore(stores: SessionStore[], preferred?: string) {
  const accessible = stores.filter((s) =>
    Object.values(s.modules).some(Boolean),
  );
  const business = stores.find((s) => s.id === preferred)?.businessId;
  return (
    accessible.find((s) => s.id === preferred && s.locationType === "store") ??
    accessible.find(
      (s) => s.locationType === "store" && s.businessId === business,
    ) ??
    accessible.find((s) => s.locationType === "store") ??
    accessible[0] ??
    null
  );
}
