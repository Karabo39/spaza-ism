create index recurring_business on public.recurring_invoices(business_id);
create index recurring_customer on public.recurring_invoices(customer_id);
create index recurring_author on public.recurring_invoices(configured_by);
create index recurring_store_business on public.recurring_invoices(store_id,business_id);
create index recurring_delivery_store on public.recurring_invoice_deliveries(store_id);
create index recurring_delivery_pending on public.recurring_invoice_deliveries(created_at,invoice_id) where state='PENDING';
