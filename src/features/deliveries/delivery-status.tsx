import { statusLabel } from "@/features/billing/status-label";
export function deliveryLabel(status: string) {
  return status === "RESCHEDULED" || status === "SCHEDULED"
    ? "Scheduled"
    : statusLabel(status);
}
export function DeliveryStatus({ status }: { status: string }) {
  const color =
    status === "DELIVERED"
      ? "bg-emerald-500 text-slate-950"
      : ["RESCHEDULED", "SCHEDULED"].includes(status)
        ? "bg-yellow-400 text-slate-950"
        : status === "CANCELLED"
          ? "bg-red-600 text-white"
          : "bg-surface-2 text-foreground";
  return (
    <span
      className={`inline-block rounded px-2 py-1 text-sm font-semibold ${color}`}
    >
      {deliveryLabel(status)}
    </span>
  );
}
