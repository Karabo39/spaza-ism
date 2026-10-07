-- Add safe, auditable deletion controls and identifier search for order queues.

alter table public.report_schedules
  add column deleted_at timestamptz;
alter table public.report_schedules
  add constraint report_schedules_deleted_inactive
  check (deleted_at is null or not active);

create or replace function public.report_schedules_page(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not app.has_module(p_store,'settings_manage') then raise exception 'FORBIDDEN';end if;
 return (select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('last_error',(select d.error from public.report_schedule_deliveries d where d.schedule_id=s.id and d.state='FAILED' order by d.claimed_at desc limit 1)) order by s.name,s.id),'[]'::jsonb)
  from public.report_schedules s where s.store_id=p_store and s.deleted_at is null);
end $$;
revoke all on function public.report_schedules_page(uuid) from public,anon;
grant execute on function public.report_schedules_page(uuid) to authenticated;

create function public.delete_report_schedule(p_id uuid,p_expected bigint) returns void
language plpgsql security definer set search_path='' as $$
declare s public.report_schedules%rowtype;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN';end if;
 select * into s from public.report_schedules where id=p_id for update;
 if not found or not app.has_module(s.store_id,'settings_manage') then raise exception 'FORBIDDEN';end if;
 if s.version is distinct from p_expected then raise exception 'SETTINGS_CHANGED';end if;
 if s.deleted_at is not null then return;end if;
 if s.active then raise exception 'DEACTIVATE_SCHEDULE_FIRST';end if;
 update public.report_schedules set active=false,deleted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=s.id;
 perform app.audit('report.schedule_delete','report_schedules',s.id,app.store_business(s.store_id),s.store_id,to_jsonb(s),jsonb_build_object('deleted_at',clock_timestamp(),'delivery_history_preserved',true));
end $$;
revoke all on function public.delete_report_schedule(uuid,bigint) from public,anon;
grant execute on function public.delete_report_schedule(uuid,bigint) to authenticated;

create function public.archive_product(p_product uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype;current_qty numeric;expired_qty numeric;undated_qty numeric;sellable_qty numeric;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN';end if;
 select * into p from public.products where id=p_product for update;
 if not found or not app.has_module(p.store_id,'products_manage') then raise exception 'FORBIDDEN';end if;
 if not p.is_active then raise exception 'PRODUCT_ALREADY_INACTIVE';end if;
 if exists(select 1 from public.bulk_conversions where pack_product_id=p.id or unit_product_id=p.id) then raise exception 'PRODUCT_IN_USE';end if;
 if app_private.online_reserved(p.id)>0 or exists(
  select 1 from public.stock_transfer_items line join public.stock_transfers transfer on transfer.id=line.transfer_id
  where (line.source_product_id=p.id or line.destination_product_id=p.id) and transfer.status in ('DRAFT','SUBMITTED','DISPATCHED')
 ) then raise exception 'PRODUCT_IN_USE';end if;
 select coalesce(v.quantity,0),coalesce(v.expired_quantity,0),coalesce(v.undated_quantity,0),coalesce(v.sellable_quantity,0)
  into current_qty,expired_qty,undated_qty,sellable_qty
  from public.v_product_catalog v where v.id=p.id;
 current_qty:=coalesce(current_qty,0);expired_qty:=coalesce(expired_qty,0);undated_qty:=coalesce(undated_qty,0);sellable_qty:=coalesce(sellable_qty,0);
 if current_qty>0 and (expired_qty<current_qty or undated_qty>0 or sellable_qty>0) then raise exception 'PRODUCT_HAS_STOCK';end if;
 update public.products set is_active=false,available_online=false,updated_at=clock_timestamp() where id=p.id;
 perform app.audit('product.archive','products',p.id,p.business_id,p.store_id,to_jsonb(p),jsonb_build_object('is_active',false,'expired_stock_preserved',current_qty>0,'history_preserved',true));
end $$;
revoke all on function public.archive_product(uuid) from public,anon;
grant execute on function public.archive_product(uuid) to authenticated;

create function public.search_online_orders_page(
 p_store uuid,p_search text default null,p_before timestamptz default null,p_before_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;term text:=regexp_replace(upper(coalesce(p_search,'')),'[^A-Z0-9]','','g');
begin
 if not app.has_module(p_store,'orders_online') then raise exception 'FORBIDDEN';end if;
 if length(term)>128 then raise exception 'INVALID_SEARCH';end if;
 select coalesce(jsonb_agg(app_private.online_customer_status(page.order_id)||jsonb_build_object('version',page.version,'invoice_id',page.invoice_id,'goods_released',exists(select 1 from public.sales_invoices i where i.id=page.invoice_id and i.goods_issued_at is not null)) order by page.created_at desc,page.order_id desc),'[]'::jsonb) into rows
 from (
  select o.order_id,o.created_at,o.version,o.invoice_id
  from public.online_orders o join public.sales_orders so on so.id=o.order_id
  where o.store_id=p_store
   and (p_before is null or (o.created_at,o.order_id)<(p_before,p_before_id))
   and (term='' or regexp_replace(upper(so.reference),'[^A-Z0-9]','','g') like '%'||term||'%')
  order by o.created_at desc,o.order_id desc limit 25
 ) page;
 return rows;
end $$;
revoke all on function public.search_online_orders_page(uuid,text,timestamptz,uuid) from public,anon;
grant execute on function public.search_online_orders_page(uuid,text,timestamptz,uuid) to authenticated;
create index sales_orders_reference_normalized_trgm
 on public.sales_orders using gin (regexp_replace(upper(reference),'[^A-Z0-9]','','g') extensions.gin_trgm_ops);

create function public.search_delivery_page(
 p_store uuid,p_queue text default 'current',p_date date default null,p_after bigint default null,p_customer uuid default null,p_search text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date;term text:=regexp_replace(upper(coalesce(p_search,'')),'[^A-Z0-9]','','g');
begin
 if not app.has_module(p_store,'orders_deliveries') then raise exception 'FORBIDDEN';end if;
 if p_queue not in ('current','scheduled','completed','cancelled','all') then raise exception 'INVALID_DELIVERY_QUEUE';end if;
 if length(term)>128 then raise exception 'INVALID_SEARCH';end if;
 select (now() at time zone timezone)::date into today from public.stores where id=p_store;
 return (select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by x.sequence desc),'[]'::jsonb)) from (
  select d.id,d.sequence,d.reference,d.status,d.scheduled_date,d.original_date,d.version,d.driver_name,d.cancellation_reason,d.cancelled_at,
   i.order_id,d.snapshot->>'order_reference' as order_reference,d.snapshot->>'customer_name' as customer_name,
   d.snapshot->>'contact_number' as contact_number,d.snapshot->>'delivery_address' as delivery_address
  from public.order_deliveries d join public.sales_invoices i on i.id=d.invoice_id
  where d.store_id=p_store and (p_after is null or d.sequence<p_after) and (p_date is null or d.scheduled_date=p_date)
   and (p_customer is null or i.customer_id=p_customer)
   and (term='' or regexp_replace(upper(d.reference),'[^A-Z0-9]','','g') like '%'||term||'%')
   and case p_queue when 'current' then d.status in ('PENDING','OUT_FOR_DELIVERY','FAILED') and d.scheduled_date<=today
    when 'scheduled' then d.status='RESCHEDULED' or (d.status='PENDING' and d.scheduled_date>today)
    when 'completed' then d.status='DELIVERED' when 'cancelled' then d.status='CANCELLED' else true end
  order by d.sequence desc limit 51
 ) x);
end $$;
revoke all on function public.search_delivery_page(uuid,text,date,bigint,uuid,text) from public,anon;
grant execute on function public.search_delivery_page(uuid,text,date,bigint,uuid,text) to authenticated;
create index order_deliveries_reference_normalized_trgm
 on public.order_deliveries using gin (regexp_replace(upper(reference),'[^A-Z0-9]','','g') extensions.gin_trgm_ops);
