-- The online metadata transition already sends a single cancellation update.
-- Keep normal staff-created order notifications unchanged.
drop trigger online_cancellation_email on public.sales_orders;
do $$ declare before text;after text;begin
 before:=pg_get_functiondef('app_private.customer_document_event()'::regprocedure);
 after:=replace(before,$match$if tg_table_name='sales_orders' then$match$,
 $replacement$if tg_table_name='sales_orders' then
  if exists(select 1 from public.online_orders where order_id=new.id) then return new;end if;$replacement$);
 if after=before then raise exception 'CUSTOMER_NOTIFICATION_MIGRATION_SHAPE';end if;
 execute after;
end $$;
