import type { SalesOrder } from "@/lib/db/database.types";

export type OrderWorkflow = SalesOrder & {
  quoted_tax_percent?: number | null;
  quoted_discount?: number | null;
  can_cancel: boolean;
  delivery_id?: string|null;
  delivery_status?: string|null;
  invoice: null | {
    invoiced_by_name?: string | null;
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
