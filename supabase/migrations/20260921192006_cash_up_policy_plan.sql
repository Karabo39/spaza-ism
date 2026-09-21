-- Evaluate the authenticated user once per statement while retaining store checks.
alter policy cash_up_read on public.cash_ups using (
  app.has_module(store_id, 'cash_up')
  and (created_by = (select auth.uid()) or app.has_store_role(store_id, 'manager'))
);
