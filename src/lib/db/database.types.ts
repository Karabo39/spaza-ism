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
      cash_ups: { Row: { id: string; business_id: string; store_id: string; business_date: string; opening_float: number; status: string; version: number; latest_submission: string | null; created_by: string; created_at: string }; Insert: never; Update: never; Relationships: [] }
      module_catalog: { Row: { key: string; label: string; minimum_role: MembershipRole }; Insert: never; Update: never; Relationships: [] }
      store_module_access: { Row: { membership_id: string; store_id: string; permissions: Json; version: number; updated_by: string | null; updated_at: string }; Insert: never; Update: never; Relationships: [] }
      import_batches: { Row: { id: string; business_id: string; store_id: string; kind: string; request_id: string; request_payload: Json; result: Json; performed_by: string; created_at: string }; Insert: never; Update: never; Relationships: [] }
      product_price_history: { Row: { id: string; business_id: string; store_id: string; product_id: string; product_name: string; old_cost: number | null; new_cost: number | null; old_selling: number | null; new_selling: number | null; reason: string; performed_by: string | null; created_at: string }; Insert: never; Update: never; Relationships: [] }
      notification_preferences: { Row: { id: string; business_id: string; store_id: string; user_id: string; kind: string; enabled: boolean; delivery_hour: number; last_sent_at: string | null; updated_at: string }; Insert: never; Update: never; Relationships: [] }
      notification_deliveries: { Row: { id: string; preference_id: string; period: string; state: string; recipient: string; payload: Json; attempts: number; created_at: string; claimed_at: string; completed_at: string | null; provider_id: string | null; error: string | null }; Insert: never; Update: never; Relationships: [] }
      store_credit_allocations: { Row: { id: string; return_id: string; invoice_id: string; business_id: string; store_id: string; amount: number; payment_entry_id: string; performed_by: string; created_at: string; request_id: string; request_payload: Json }; Insert: never; Update: never; Relationships: [] }
      billing_settings: { Row: BillingSettings; Insert: never; Update: never; Relationships: [] }
      sales_orders: { Row: SalesOrder; Insert: never; Update: never; Relationships: [] }
      sales_order_items: { Row: SalesOrderItem; Insert: never; Update: never; Relationships: [] }
      sales_invoices: { Row: SalesInvoice; Insert: never; Update: never; Relationships: [] }
      sales_invoice_items: { Row: SalesInvoiceItem; Insert: never; Update: never; Relationships: [] }
      invoice_entries: { Row: InvoiceEntry; Insert: never; Update: never; Relationships: [] }
      goods_returns: { Row: GoodsReturn; Insert: never; Update: never; Relationships: [] }
      goods_return_items: { Row: GoodsReturnItem; Insert: never; Update: never; Relationships: [] }
      return_dispositions: { Row: ReturnDisposition; Insert: never; Update: never; Relationships: [] }
      customer_refunds: { Row: CustomerRefund; Insert: never; Update: never; Relationships: [] }
      bulk_conversions: {
        Row: { id: string; business_id: string; store_id: string; pack_product_id: string; unit_product_id: string; pack_name: string; unit_name: string; units_per_pack: number; updated_by: string; updated_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      bulk_unpackings: {
        Row: { id: string; reference: string; business_id: string; store_id: string; conversion_id: string; pack_product_id: string; unit_product_id: string; pack_name: string; unit_name: string; units_per_pack: number; packs: number; units: number; reason: string; performed_by: string; created_at: string; request_id: string }
        Insert: never
        Update: never
        Relationships: []
      }
      stock_transfers: {
        Row: { id: string; business_id: string; source_id: string; destination_id: string; reference: string; status: TransferStatus; note: string | null; cancellation_reason: string | null; created_by: string; dispatched_by: string | null; received_by: string | null; created_at: string; submitted_at: string | null; dispatched_at: string | null; received_at: string | null; cancelled_at: string | null; request_id: string; request_payload: Json }
        Insert: never
        Update: never
        Relationships: []
      }
      stock_transfer_items: {
        Row: { id: string; transfer_id: string; source_product_id: string; destination_product_id: string; source_name: string; destination_name: string; quantity: number; unit_cost: number; batches: Json }
        Insert: never
        Update: never
        Relationships: []
      }
      audit_logs: {
        Row: { action: string; actor_id: string | null; after_data: Json | null; before_data: Json | null; business_id: string | null; created_at: string; entity_id: string | null; entity_type: string | null; id: string; store_id: string | null }
        Insert: { action: string; actor_id?: string | null; after_data?: Json | null; before_data?: Json | null; business_id?: string | null; created_at?: string; entity_id?: string | null; entity_type?: string | null; id?: string; store_id?: string | null }
        Update: Partial<Database["public"]["Tables"]["audit_logs"]["Insert"]>
        Relationships: []
      }
      businesses: {
        Row: { created_at: string; created_by: string | null; currency: string; id: string; name: string; slug: string | null; updated_at: string; logo_path: string | null }
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
        Row: { authorized_by: string | null; business_id: string; created_at: string; credit_override: boolean; customer_id: string | null; id: string; note: string | null; performed_by: string | null; sale_type: SaleType; store_id: string; total_amount: number; payment_reference: string | null; request_id: string | null; request_payload: Json | null }
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
        Row: { counted: boolean; counted_qty: number | null; id: string; product_id: string; stock_take_id: string; system_qty: number; variance: number | null; counted_expiry: string | null; counted_at: string | null; counted_by: string | null }
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
      store_memberships: {
        Row: { membership_id: string; store_id: string; business_id: string; assigned_by: string | null; created_at: string }
        Insert: { membership_id: string; store_id: string; business_id: string; assigned_by?: string | null; created_at?: string }
        Update: Partial<Database["public"]["Tables"]["store_memberships"]["Insert"]>
        Relationships: []
      }
      stores: {
        Row: { address: string | null; business_id: string; code: string | null; created_at: string; id: string; is_active: boolean; name: string; timezone: string; updated_at: string; location_type: LocationType }
        Insert: { address?: string | null; business_id: string; code?: string | null; created_at?: string; id?: string; is_active?: boolean; name: string; timezone?: string; updated_at?: string; location_type?: LocationType }
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
      v_return_report: { Row: { id: string; business_id: string; store_id: string; reference: string; invoice_id: string | null; sale_id: string | null; customer_id: string | null; status: string; reason: string; inspection: string; created_at: string; amount: number; items: string; quantity: number; inventory_actions: string; refunded: number; allocated_credit: number }; Relationships: [] }
      v_stock_take_variance: { Row: { id: string; stock_take_id: string; business_id: string; store_id: string; created_at: string; status: string; product_name: string; product_id: string; system_qty: number; counted_qty: number | null; variance: number | null; counted: boolean; counted_at: string | null; counted_expiry: string | null; counted_by: string | null }; Relationships: [] }
      v_payment_activity: { Row: { id: string; store_id: string; business_id: string; created_at: string; method: string; amount: number; reference: string; payment_reference: string | null; source: string; document_id: string }; Relationships: [] }
      v_invoice_balances: { Row: InvoiceBalance; Relationships: [] }
      v_audit_activity: { Row: Database["public"]["Tables"]["audit_logs"]["Row"] & { actor_name: string | null; location_name: string | null; stock_items: string }; Relationships: [] }
      v_invoice_payment_report: { Row: InvoiceBalance & { payment_methods: string[] }; Relationships: [] }
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
      order_workflow_summary: { Args: { p_store: string }; Returns: Json };
      cash_up_summary: { Args: { p_store: string; p_day: string }; Returns: Json }
      open_cash_up: { Args: { p_store: string; p_day: string; p_float: number }; Returns: string }
      submit_cash_up: { Args: { p_cash_up: string; p_counted: number; p_denominations: Json; p_fingerprint: string; p_note: string; p_request: string }; Returns: string }
      review_cash_up: { Args: { p_cash_up: string; p_submission: string; p_action: string; p_note: string }; Returns: undefined }
      correct_cash_up_float: { Args: { p_cash_up: string; p_float: number; p_version: number; p_reason: string }; Returns: undefined }
      record_cash_movement: { Args: { p_store: string; p_day: string; p_kind: string; p_amount: number; p_reason: string; p_request: string }; Returns: string }
      record_credit_payment_tender: { Args: { p_customer: string; p_amount: number; p_method: string; p_request: string; p_note?: string }; Returns: string }
      classify_credit_payment: { Args: { p_transaction: string; p_method: string }; Returns: undefined }
      my_module_access: { Args: { p_store: string }; Returns: Json }
      set_store_module_access: { Args: { p_membership: string; p_store: string; p_permissions: Json; p_expected: number }; Returns: number }
      save_stock_take_count: { Args: { p_item: string; p_quantity: number | null; p_expiry?: string }; Returns: undefined }
      cancel_stock_take: { Args: { p_stock_take: string; p_reason: string }; Returns: undefined }
      unpack_stock_with_count: { Args: { p_conversion: string; p_packs: number; p_counted: number; p_reason: string; p_request: string; p_expiry?: string }; Returns: string }
      set_business_logo: { Args: { p_business: string; p_path: string | null }; Returns: undefined }
      import_excel: { Args: { p_store: string; p_kind: string; p_rows: Json; p_request: string; p_preview?: boolean }; Returns: Json }
      profit_summary: { Args: { p_store: string; p_from: string; p_to: string }; Returns: Json }
      set_notification_preference: { Args: { p_store: string; p_kind: string; p_enabled: boolean; p_hour?: number }; Returns: string }
      prepare_report_email: { Args: { p_store: string; p_request: string; p_hash: string; p_recipient: string }; Returns: Json }
      complete_report_email: { Args: { p_job: string; p_provider: string }; Returns: undefined }
      allocate_return_credit: { Args: { p_return: string; p_invoice: string; p_amount: number; p_request: string }; Returns: string }
      invoice_summary: { Args: { p_store: string }; Returns: Json }
      invoice_monthly_reconciliation: { Args: { p_store: string; p_month: string }; Returns: Json }
      set_billing_settings: { Args: { p_business: string; p_tax: number; p_return_approval: boolean }; Returns: undefined }
      set_return_reasons: { Args: { p_business: string; p_reasons: string[] }; Returns: undefined }
      create_sales_order: { Args: { p_store: string; p_customer: string; p_items: Json; p_request: string; p_note?: string }; Returns: string }
      process_sales_order: { Args: { p_order: string; p_action: string; p_reason?: string }; Returns: string }
      create_sales_invoice: { Args: { p_order: string; p_due: string; p_terms: string; p_discount?: number; p_note?: string }; Returns: string }
      issue_sales_invoice: { Args: { p_invoice: string }; Returns: string }
      post_invoice_entry: { Args: { p_invoice: string; p_kind: string; p_amount: number; p_request: string; p_method?: string; p_reference?: string; p_reason?: string }; Returns: string }
      issue_invoice_goods: { Args: { p_invoice: string; p_override?: boolean; p_override_token?: string }; Returns: string }
      cancel_sales_invoice: { Args: { p_invoice: string; p_reason: string }; Returns: string }
      submit_goods_return: { Args: { p_source_type: string; p_source: string; p_items: Json; p_reason: string; p_inspection: string; p_request: string }; Returns: string }
      process_goods_return: { Args: { p_return: string; p_approve: boolean; p_reason?: string }; Returns: string }
      resolve_return_quarantine: { Args: { p_item: string; p_action: string; p_reason: string; p_expiry?: string }; Returns: string }
      record_customer_refund: { Args: { p_return: string; p_amount: number; p_method: string; p_reason: string; p_request: string; p_reference?: string }; Returns: string }
      transfer_history: { Args: { p_business: string; p_source?: string; p_destination?: string; p_status?: string; p_product?: string; p_user?: string; p_from?: string; p_to?: string }; Returns: Database["public"]["Tables"]["stock_transfers"]["Row"][] }
      set_bulk_conversion: { Args: { p_pack: string; p_unit: string; p_ratio: number }; Returns: string }
      unpack_stock: { Args: { p_conversion: string; p_packs: number; p_reason: string; p_request: string }; Returns: string }
      create_stock_transfer: { Args: { p_source: string; p_destination: string; p_items: Json; p_request: string; p_note?: string }; Returns: string }
      process_stock_transfer: { Args: { p_transfer: string; p_action: string; p_reason?: string }; Returns: TransferStatus }
      business_location_summary: { Args: { p_business: string }; Returns: { location_id: string; name: string; location_type: LocationType; product_count: number; stock_quantity: number; stock_value: number }[] }
      create_location: { Args: { p_business: string; p_name: string; p_type: LocationType; p_code?: string }; Returns: string }
      update_location: { Args: { p_store: string; p_name: string; p_code?: string }; Returns: undefined }
      set_member_locations: { Args: { p_membership: string; p_stores: string[] }; Returns: undefined }
      adjust_stock: { Args: { p_new_qty: number; p_note?: string; p_product: string; p_reason: string; p_store: string; p_expiry?: string; p_request?: string; p_expected?: number }; Returns: string }
      complete_sale: { Args: { p_customer: string | null; p_items: Json; p_note?: string; p_override?: boolean; p_sale_type: string; p_store: string; p_request?: string; p_payment_reference?: string; p_override_token?: string }; Returns: string }
      set_credit_override_code: { Args: { p_business: string; p_code: string }; Returns: undefined }
      credit_override_authorizers: { Args: { p_store: string }; Returns: { user_id: string; name: string }[] }
      authorize_credit_override: { Args: { p_store: string; p_customer: string; p_manager: string; p_code: string; p_amount: number }; Returns: Json }
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
export type LocationType = "store" | "warehouse"
export type TransferStatus = "DRAFT" | "SUBMITTED" | "DISPATCHED" | "RECEIVED" | "CANCELLED"
export type MovementType =
  | "GOODS_IN" | "SALE_CASH" | "SALE_CREDIT" | "ADJUSTMENT_INCREASE"
  | "ADJUSTMENT_DECREASE" | "STOCK_TAKE" | "DAMAGED" | "EXPIRED"
  | "TRANSFER_IN" | "TRANSFER_OUT" | "RETURN_IN" | "VOID_REVERSAL"
  | "UNPACK_IN" | "UNPACK_OUT"
  | "SALE_CARD"
export type SaleType = "CASH" | "CREDIT" | "CARD_EFT"
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


export type BillingSettings = {
  business_id: string;
  tax_percent: number;
  return_approval_required: boolean;
  return_reasons: string[];
};

export type SalesOrder = {
  id: string;
  business_id: string;
  store_id: string;
  customer_id: string;
  reference: string;
  status: string;
  customer_name: string;
  note: string | null;
  created_by: string;
  created_at: string;
  confirmed_at: string | null;
  cancellation_reason: string | null;
  request_id: string;
  request_payload: Json;
};

export type SalesOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type SalesInvoice = {
  id: string;
  business_id: string;
  store_id: string;
  order_id: string;
  customer_id: string;
  customer_name: string;
  business_name: string;
  store_name: string;
  currency: string;
  salesperson: string;
  created_by: string;
  reference: string;
  state: string;
  terms: string;
  subtotal: number;
  discount: number;
  tax_percent: number;
  tax_amount: number;
  total: number;
  due_date: string;
  note: string | null;
  cancellation_reason: string | null;
  created_at: string;
  issued_at: string | null;
  goods_issued_at: string | null;
  goods_issued_by: string | null;
  authorized_by: string | null;
};

export type SalesInvoiceItem = {
  id: string;
  invoice_id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  net_total: number;
  cost_price: number;
  batches: Json;
};

export type InvoiceEntry = {
  id: string;
  invoice_id: string;
  business_id: string;
  store_id: string;
  reference: string;
  kind: string;
  amount: number;
  method: string | null;
  payment_reference: string | null;
  reason: string | null;
  performed_by: string;
  created_at: string;
  request_id: string;
  request_payload: Json;
};

export type GoodsReturn = {
  id: string;
  business_id: string;
  store_id: string;
  invoice_id: string | null;
  sale_id: string | null;
  customer_id: string | null;
  reference: string;
  status: string;
  reason: string;
  inspection: string;
  amount: number;
  credit_entry_id: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  processed_at: string | null;
  decision_reason: string | null;
  request_id: string;
  request_payload: Json;
};

export type GoodsReturnItem = {
  id: string;
  return_id: string;
  invoice_item_id: string | null;
  sale_item_id: string | null;
  product_id: string;
  product_name: string;
  quantity: number;
  amount: number;
  condition: string;
  inventory_action: string;
  expiry_date: string | null;
};

export type ReturnDisposition = {
  id: string;
  return_item_id: string;
  action: string;
  reason: string;
  expiry_date: string | null;
  performed_by: string;
  created_at: string;
};

export type CustomerRefund = {
  id: string;
  return_id: string;
  business_id: string;
  store_id: string;
  reference: string;
  amount: number;
  method: string;
  payment_reference: string | null;
  reason: string;
  performed_by: string;
  created_at: string;
  request_id: string;
  request_payload: Json;
};

export type InvoiceBalance = SalesInvoice & { debits: number; credits: number; paid: number; outstanding: number; status: string; };
