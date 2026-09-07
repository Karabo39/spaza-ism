export type CashSession = {
  id: string;
  business_date: string;
  opening_float: number;
  status: "OPEN" | "SUBMITTED" | "APPROVED";
  version: number;
  latest_submission: string | null;
};
export type CashSummary = {
  session: CashSession | null;
  expected: number;
  count_token: string;
  changed_since_count: boolean;
  sources: {
    sales: number;
    invoices: number;
    credit: number;
    refunds: number;
    added: number;
    removed: number;
    net: number;
    fingerprint: string;
    unclassified: {
      id: string;
      amount: number;
      customer_name: string;
      created_at: string;
    }[];
  };
  history: {
    id: string;
    revision: number;
    counted: number;
    expected: number;
    variance: number;
    note: string | null;
    created_at: string;
    created_by_name: string;
    reviews: {
      id: string;
      action: "APPROVE" | "REOPEN";
      note: string | null;
      created_at: string;
      created_by_name: string;
    }[];
  }[];
  movements: {
    id: string;
    kind: "ADD" | "REMOVE";
    amount: number;
    reason: string;
    created_at: string;
  }[];
};
