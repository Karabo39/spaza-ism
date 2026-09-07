-- Orders need their own limited invoice summary, including for Orders-only staff.
-- Read-only: derive completion from the ledger; never rewrite historic orders.
create function public.order_workflow_summary(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,app as $$
begin
  perform app.require_module(p_store,array['orders']);
  return coalesce((select jsonb_agg(row_data order by created_at desc,id desc) from (
    select o.id,o.created_at,to_jsonb(o) || jsonb_build_object(
      'status',case when o.status='CANCELLED' then 'CANCELLED'
        when i.state='ISSUED' and i.goods_issued_at is not null and i.outstanding<=0 then 'COMPLETED'
        when i.state='ISSUED' and i.goods_issued_at is not null then 'AWAITING_PAYMENT'
        when i.state='ISSUED' and i.outstanding<=0 then 'READY_FOR_COLLECTION'
        when i.id is not null then 'INVOICED' else o.status end,
      'can_cancel',o.status<>'CANCELLED' and (i.id is null or
        (i.state in ('DRAFT','ISSUED') and i.goods_issued_at is null and not exists(
          select 1 from public.invoice_entries e where e.invoice_id=i.id and e.kind<>'ISSUE'))),
      'invoice',case when i.id is null then null else jsonb_build_object(
        'id',i.id,'reference',i.reference,'state',i.state,'status',i.status,
        'total',i.total,'paid',i.paid,'credits',i.credits,'outstanding',i.outstanding,
        'goods_issued_at',i.goods_issued_at,'terms',i.terms) end) as row_data
    from (select * from public.sales_orders where store_id=p_store
      order by created_at desc,id desc limit 200) o
    left join public.v_invoice_balances i on i.order_id=o.id and i.store_id=p_store
  ) summary),'[]'::jsonb);
end;
$$;
revoke all on function public.order_workflow_summary(uuid) from public,anon;
grant execute on function public.order_workflow_summary(uuid) to authenticated;

-- Anonymous-safe feature probe: no business data, keys, or migration history.
create or replace function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
    'order_workflow_v1', to_regprocedure('public.order_workflow_summary(uuid)') is not null,
    'brd_v102', to_regprocedure('public.invoice_summary(uuid)') is not null
      and exists(select 1 from pg_attribute where attrelid=to_regclass('public.stores') and attname='location_type' and not attisdropped),
    'module_access_v1', to_regprocedure('public.my_module_access(uuid)') is not null
      and to_regprocedure('public.set_store_module_access(uuid,uuid,jsonb,bigint)') is not null,
    'cash_up_v1', to_regprocedure('public.cash_up_summary(uuid,date)') is not null
      and to_regprocedure('public.submit_cash_up(uuid,numeric,jsonb,text,text,uuid)') is not null
  ));
$$;
revoke all on function public.app_schema_status() from public;
grant execute on function public.app_schema_status() to anon,authenticated,service_role;
