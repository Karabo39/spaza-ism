import type { SalesOrder } from "@/lib/db/database.types";

export type OrderWorkflow = SalesOrder & {
  can_cancel: boolean;
  invoice: null | {
    id: string;
    reference: string;
    state: string;
    status: string;
    total: number;
    paid: number;
    credits: number;
    outstanding: number;
    goods_issued_at: string | null;
    terms: string;
  };
};
