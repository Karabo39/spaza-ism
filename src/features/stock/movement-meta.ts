import type { MovementType } from "@/lib/db/database.types";

type Variant = "neutral" | "success" | "warning" | "danger" | "accent" | "primary";

export const MOVEMENT_META: Record<MovementType, { label: string; variant: Variant }> = {
  GOODS_IN: { label: "Goods In", variant: "success" },
  SALE_CASH: { label: "Cash Sale", variant: "accent" },
  SALE_CREDIT: { label: "Credit Sale", variant: "primary" },
  ADJUSTMENT_INCREASE: { label: "Adj +", variant: "neutral" },
  ADJUSTMENT_DECREASE: { label: "Adj −", variant: "neutral" },
  STOCK_TAKE: { label: "Stock Take", variant: "warning" },
  DAMAGED: { label: "Damaged", variant: "danger" },
  EXPIRED: { label: "Expired", variant: "danger" },
  TRANSFER_IN: { label: "Transfer In", variant: "success" },
  TRANSFER_OUT: { label: "Transfer Out", variant: "warning" },
  RETURN_IN: { label: "Return", variant: "success" },
  VOID_REVERSAL: { label: "Reversal", variant: "neutral" },
};

export const REASON_LABELS: Record<string, string> = {
  DAMAGED: "Damaged",
  EXPIRED: "Expired",
  MISSING: "Missing",
  STOCK_COUNT_CORRECTION: "Count correction",
  THEFT: "Theft",
  OTHER: "Other",
};
