-- Staff-only delivery release state; retain existing access checks and bounded pages.
create or replace function public.online_orders_page(p_store uuid,p_before timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin if not app.has_module(p_store,'orders_online') then raise exception 'FORBIDDEN';end if;
 select coalesce(jsonb_agg(app_private.online_customer_status(order_id)||jsonb_build_object('version',version,'invoice_id',invoice_id,'goods_released',exists(select 1 from public.sales_invoices i where i.id=page.invoice_id and i.goods_issued_at is not null)) order by created_at desc,order_id desc),'[]') into rows
 from (select * from public.online_orders where store_id=p_store and (p_before is null or (created_at,order_id)<(p_before,p_before_id)) order by created_at desc,order_id desc limit 25) page;
 return rows;
end $$;
