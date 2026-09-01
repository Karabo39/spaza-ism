export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      audit_logs: {
        Row: { action: string; actor_id: string | null; after_data: Json | null; before_data: Json | null; business_id: string | null; created_at: string; entity_id: string | null; entity_type: string | null; id: string; store_id: string | null }
        Insert: { action: string; actor_id?: string | null; after_data?: Json | null; before_data?: Json | null; business_id?: string | null; created_at?: string; entity_id?: string | null; entity_type?: string | null; id?: string; store_id?: string | null }
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Insert"]>
        Relationships: []
      }
      businesses: {
        Row: { created_at: string; created_by: string | null; currency: string; id: string; name: string; slug: string | null; updated_at: string }
        Insert: { created_at?: string; created_by?: string | null; currency?: string; id?: string; name: string; slug?: string | null; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["businesses"]["Insert"]>
        Relationships: []
      }
      categories: {
        Row: { business_id: string; created_at: string; id: string; name: string; updated_at: string }
        Insert: { business_id: string; created_at?: string; id?: string; name: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>
        Relationships: []
      }
      credit_accounts: {
        Row: { balance: number; business_id: string; created_at: string; credit_limit: number; customer_id: string; id: string; store_id: string; updated_at: string }
        Insert: { balance?: number; business_id: string; created_at?: string; credit_limit?: number; customer_id: string; id?: string; store_id: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["credit_accounts"]["Insert"]>
        Relationships: []
      }
      credit_transactions: {
        Row: { amount: number; balance_after: number; business_id: string; created_at: string; credit_account_id: string; id: string; note: string | null; performed_by: string | null; reference_id: string | null; reference_table: string | null; store_id: string; txn_type: CreditTxnType }
        Insert: { amount: number; balance_after: number; business_id: string; created_at?: string; credit_account_id: string; id?: string; note?: string | null; performed_by?: string | null; reference_id?: string | null; reference_table?: string | null; store_id: string; txn_type: CreditTxnType }
        Update: Partial<Database["public"]["Tables"]["credit_transactions"]["Insert"]>
        Relationships: []
      }
      customers: {
        Row: { business_id: string; created_at: string; email: string | null; id: string; is_active: boolean; name: string; notes: string | null; phone: string | null; store_id: string; updated_at: string }
        Insert: { business_id: string; created_at?: string; email?: string | null; id?: string; is_active?: boolean; name: string; notes?: string | null; phone?: string | null; store_id: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["customers"]["Insert"]>
        Relationships: []
      }
      goods_in: {
        Row: { business_id: string; created_at: string; id: string; note: string | null; performed_by: string | null; reference: string | null; store_id: string; supplier_id: string | null; total_cost: number }
        Insert: { business_id: string; created_at?: string; id?: string; note?: string | null; performed_by?: string | null; reference?: string | null; store_id: string; supplier_id?: string | null; total_cost?: number }
        Update: Partial<Database["public"]["Tables"]["goods_in"]["Insert"]>
        Relationships: []
      }
      goods_in_items: {
        Row: { batch_ref: string | null; expiry_date: string | null; goods_in_id: string; id: string; line_total: number; product_id: string; quantity: number; unit_cost: number }
        Insert: { batch_ref?: string | null; expiry_date?: string | null; goods_in_id: string; id?: string; line_total?: number; product_id: string; quantity: number; unit_cost?: number }
        Update: Partial<Database["public"]["Tables"]["goods_in_items"]["Insert"]>
        Relationships: []
      }
      goods_out: {
        Row: { authorized_by: string | null; business_id: string; created_at: string; credit_override: boolean; customer_id: string | null; id: string; note: string | null; performed_by: string | null; sale_type: SaleType; store_id: string; total_amount: number }
        Insert: { authorized_by?: string | null; business_id: string; created_at?: string; credit_override?: boolean; customer_id?: string | null; id?: string; note?: string | null; performed_by?: string | null; sale_type: SaleType; store_id: string; total_amount?: number }
        Update: Partial<Database["public"]["Tables"]["goods_out"]["Insert"]>
        Relationships: []
      }
      goods_out_items: {
        Row: { goods_out_id: string; id: string; line_total: number; product_id: string; quantity: number; unit_price: number }
        Insert: { goods_out_id: string; id?: string; line_total?: number; product_id: string; quantity: number; unit_price: number }
        Update: Partial<Database["public"]["Tables"]["goods_out_items"]["Insert"]>
        Relationships: []
      }
      memberships: {
        Row: { business_id: string; created_at: string; id: string; is_active: boolean; role: MembershipRole; updated_at: string; user_id: string }
        Insert: { business_id: string; created_at?: string; id?: string; is_active?: boolean; role?: MembershipRole; updated_at?: string; user_id: string }
        Update: Partial<Database["public"]["Tables"]["memberships"]["Insert"]>
        Relationships: []
      }
      price_history: {
        Row: { changed_at: string; changed_by: string | null; id: string; new_cost: number | null; new_selling: number | null; old_cost: number | null; old_selling: number | null; product_id: string; source: string | null; store_id: string }
        Insert: { changed_at?: string; changed_by?: string | null; id?: string; new_cost?: number | null; new_selling?: number | null; old_cost?: number | null; old_selling?: number | null; product_id: string; source?: string | null; store_id: string }
        Update: Partial<Database["public"]["Tables"]["price_history"]["Insert"]>
        Relationships: []
      }
      product_barcodes: {
        Row: { barcode: string; created_at: string; id: string; is_active: boolean; product_id: string; store_id: string }
        Insert: { barcode: string; created_at?: string; id?: string; is_active?: boolean; product_id: string; store_id: string }
        Update: Partial<Database["public"]["Tables"]["product_barcodes"]["Insert"]>
        Relationships: []
      }
      products: {
        Row: { business_id: string; category_id: string | null; cost_price: number; created_at: string; created_by: string | null; default_supplier_id: string | null; id: string; is_active: boolean; min_stock_level: number; name: string; reorder_level: number; selling_price: number; sku: string | null; store_id: string; track_expiry: boolean; unit: string; updated_at: string }
        Insert: { business_id: string; category_id?: string | null; cost_price?: number; created_at?: string; created_by?: string | null; default_supplier_id?: string | null; id?: string; is_active?: boolean; min_stock_level?: number; name: string; reorder_level?: number; selling_price?: number; sku?: string | null; store_id: string; track_expiry?: boolean; unit?: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>
        Relationships: []
      }
      profiles: {
        Row: { created_at: string; full_name: string | null; id: string; phone: string | null; updated_at: string }
        Insert: { created_at?: string; full_name?: string | null; id: string; phone?: string | null; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>
        Relationships: []
      }
      stock: {
        Row: { id: string; product_id: string; quantity: number; store_id: string; updated_at: string }
        Insert: { id?: string; product_id: string; quantity?: number; store_id: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["stock"]["Insert"]>
        Relationships: []
      }
      stock_adjustments: {
        Row: { business_id: string; created_at: string; delta: number; id: string; note: string | null; performed_by: string | null; product_id: string; quantity_after: number; quantity_before: number; reason: AdjustmentReason; store_id: string }
        Insert: { business_id: string; created_at?: string; delta: number; id?: string; note?: string | null; performed_by?: string | null; product_id: string; quantity_after: number; quantity_before: number; reason: AdjustmentReason; store_id: string }
        Update: Partial<Database["public"]["Tables"]["stock_adjustments"]["Insert"]>
        Relationships: []
      }
      stock_batches: {
        Row: { batch_ref: string | null; created_at: string; expiry_date: string | null; id: string; product_id: string; quantity: number; store_id: string; updated_at: string }
        Insert: { batch_ref?: string | null; created_at?: string; expiry_date?: string | null; id?: string; product_id: string; quantity?: number; store_id: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["stock_batches"]["Insert"]>
        Relationships: []
      }
      stock_movements: {
        Row: { business_id: string; created_at: string; id: string; movement_type: MovementType; performed_by: string | null; product_id: string; quantity_after: number; quantity_before: number; quantity_delta: number; reason: string | null; reference_id: string | null; reference_table: string | null; store_id: string; unit_cost: number | null }
        Insert: { business_id: string; created_at?: string; id?: string; movement_type: MovementType; performed_by?: string | null; product_id: string; quantity_after: number; quantity_before: number; quantity_delta: number; reason?: string | null; reference_id?: string | null; reference_table?: string | null; store_id: string; unit_cost?: number | null }
        Update: Partial<Database["public"]["Tables"]["stock_movements"]["Insert"]>
        Relationships: []
      }
      stock_take_items: {
        Row: { counted: boolean; counted_qty: number | null; id: string; product_id: string; stock_take_id: string; system_qty: number; variance: number | null }
        Insert: { counted?: boolean; counted_qty?: number | null; id?: string; product_id: string; stock_take_id: string; system_qty?: number; variance?: number | null }
        Update: Partial<Database["public"]["Tables"]["stock_take_items"]["Insert"]>
        Relationships: []
      }
      stock_takes: {
        Row: { approved_by: string | null; business_id: string; completed_at: string | null; created_at: string; id: string; note: string | null; started_by: string | null; status: StockTakeStatus; store_id: string; updated_at: string }
        Insert: { approved_by?: string | null; business_id: string; completed_at?: string | null; created_at?: string; id?: string; note?: string | null; started_by?: string | null; status?: StockTakeStatus; store_id: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["stock_takes"]["Insert"]>
        Relationships: []
      }
      stores: {
        Row: { address: string | null; business_id: string; code: string | null; created_at: string; id: string; is_active: boolean; name: string; timezone: string; updated_at: string }
        Insert: { address?: string | null; business_id: string; code?: string | null; created_at?: string; id?: string; is_active?: boolean; name: string; timezone?: string; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["stores"]["Insert"]>
        Relationships: []
      }
      supplier_invoices: {
        Row: { amount: number; business_id: string; created_at: string; goods_in_id: string | null; id: string; invoice_date: string | null; reference: string | null; store_id: string; supplier_id: string | null }
        Insert: { amount?: number; business_id: string; created_at?: string; goods_in_id?: string | null; id?: string; invoice_date?: string | null; reference?: string | null; store_id: string; supplier_id?: string | null }
        Update: Partial<Database["public"]["Tables"]["supplier_invoices"]["Insert"]>
        Relationships: []
      }
      suppliers: {
        Row: { address: string | null; business_id: string; contact_name: string | null; created_at: string; email: string | null; id: string; is_active: boolean; name: string; notes: string | null; phone: string | null; updated_at: string }
        Insert: { address?: string | null; business_id: string; contact_name?: string | null; created_at?: string; email?: string | null; id?: string; is_active?: boolean; name: string; notes?: string | null; phone?: string | null; updated_at?: string }
        Update: Partial<Database["public"]["Tables"]["suppliers"]["Insert"]>
        Relationships: []
      }
    }
    Views: {
      v_product_stock: {
        Row: {
          id: string; business_id: string; store_id: string; name: string; sku: string | null; unit: string;
          cost_price: number; selling_price: number; min_stock_level: number; reorder_level: number;
          track_expiry: boolean; is_active: boolean; category_id: string | null; default_supplier_id: string | null;
          quantity: number; stock_value: number; retail_value: number;
          category_name: string | null; supplier_name: string | null;
          stock_status: "out" | "low" | "reorder" | "ok"; suggested_reorder: number;
        }
        Relationships: []
      }
      v_credit_customers: {
        Row: {
          customer_id: string; business_id: string; store_id: string; name: string;
          phone: string | null; email: string | null; is_active: boolean;
          credit_account_id: string; credit_limit: number; balance: number;
          available_credit: number; over_limit: boolean;
        }
        Relationships: []
      }
    }
    Functions: {
      adjust_stock: { Args: { p_new_qty: number; p_note?: string; p_product: string; p_reason: string; p_store: string }; Returns: string }
      complete_sale: { Args: { p_customer: string | null; p_items: Json; p_note?: string; p_override?: boolean; p_sale_type: string; p_store: string }; Returns: string }
      complete_stock_take: { Args: { p_stock_take: string }; Returns: undefined }
      create_business: { Args: { p_name: string; p_store_name?: string }; Returns: Json }
      add_member_by_email: { Args: { p_business: string; p_email: string; p_role: string }; Returns: string }
      dashboard_summary: { Args: { p_store: string }; Returns: Json }
      customer_statement: { Args: { p_customer: string }; Returns: { id: string; created_at: string; txn_type: CreditTxnType; amount: number; balance_after: number; note: string | null }[] }
      product_sales_summary: { Args: { p_store: string; p_from?: string | null; p_to?: string | null }; Returns: { product_id: string; name: string; sold_qty: number; sold_value: number; current_qty: number }[] }
      create_product: { Args: { p_barcode?: string; p_category?: string; p_cost?: number; p_min?: number; p_name: string; p_reorder?: number; p_selling?: number; p_store: string; p_supplier?: string; p_track_expiry?: boolean; p_unit?: string }; Returns: string }
      receive_stock: { Args: { p_items: Json; p_note: string | null; p_reference: string | null; p_store: string; p_supplier: string | null }; Returns: string }
      reconcile_stock: { Args: { p_store: string }; Returns: { diff: number; ledger_qty: number; product_id: string; stock_qty: number }[] }
      record_credit_payment: { Args: { p_amount: number; p_customer: string; p_note?: string }; Returns: string }
      set_credit_limit: { Args: { p_customer: string; p_limit: number }; Returns: undefined }
      start_stock_take: { Args: { p_note?: string; p_store: string }; Returns: string }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type MembershipRole = "owner" | "manager" | "employee"
export type MovementType =
  | "GOODS_IN" | "SALE_CASH" | "SALE_CREDIT" | "ADJUSTMENT_INCREASE"
  | "ADJUSTMENT_DECREASE" | "STOCK_TAKE" | "DAMAGED" | "EXPIRED"
  | "TRANSFER_IN" | "TRANSFER_OUT" | "RETURN_IN" | "VOID_REVERSAL"
export type SaleType = "CASH" | "CREDIT"
export type AdjustmentReason = "DAMAGED" | "EXPIRED" | "MISSING" | "STOCK_COUNT_CORRECTION" | "THEFT" | "OTHER"
export type CreditTxnType = "CREDIT_SALE" | "PAYMENT" | "ADJUSTMENT" | "OPENING_BALANCE"
export type StockTakeStatus = "IN_PROGRESS" | "PENDING_APPROVAL" | "COMPLETED" | "CANCELLED"

type PublicSchema = Database["public"]
export type ProductStock = {
  id: string; business_id: string; store_id: string; name: string; sku: string | null; unit: string;
  cost_price: number; selling_price: number; min_stock_level: number; reorder_level: number;
  track_expiry: boolean; is_active: boolean; category_id: string | null; default_supplier_id: string | null;
  quantity: number; stock_value: number; retail_value: number;
  category_name: string | null; supplier_name: string | null;
  stock_status: "out" | "low" | "reorder" | "ok"; suggested_reorder: number;
}

export type CreditCustomer = {
  customer_id: string; business_id: string; store_id: string; name: string;
  phone: string | null; email: string | null; is_active: boolean;
  credit_account_id: string; credit_limit: number; balance: number;
  available_credit: number; over_limit: boolean;
}

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
