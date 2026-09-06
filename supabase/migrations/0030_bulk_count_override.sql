-- A shortage override requires a manager's physical count. The correction and
-- unpack post together, preserving non-negative stock and an explicit ledger.
create table public.bulk_count_overrides (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),store_id uuid not null,
  unpacking_id uuid not null unique references public.bulk_unpackings(id), request_id uuid not null,request_payload jsonb not null,
  quantity_before numeric(14,3) not null,counted_quantity integer not null,reason text not null,authorized_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
  foreign key(store_id,business_id) references public.stores(id,business_id),unique(business_id,request_id)
);
alter table public.bulk_count_overrides enable row level security;
revoke all on public.bulk_count_overrides from public,anon,authenticated;
grant select on public.bulk_count_overrides to authenticated;
create policy bulk_override_read on public.bulk_count_overrides for select to authenticated using(app.has_store_role(store_id,'manager'));
create trigger bulk_override_immutable before update or delete on public.bulk_count_overrides for each row execute function app.block_mutation();
create function public.unpack_stock_with_count(p_conversion uuid,p_packs integer,p_counted integer,p_reason text,p_request uuid,p_expiry date default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare c public.bulk_conversions%rowtype; prior public.bulk_count_overrides%rowtype; payload jsonb; available numeric; correction numeric; cost numeric; tracked boolean; uid uuid; aid uuid;
begin
  select * into c from public.bulk_conversions where id=p_conversion for share;
  if not found or not app.has_store_role(c.store_id,'manager') then raise exception 'FORBIDDEN';end if;
  if p_packs is null or p_packs<1 or p_counted is null or p_counted<p_packs or p_request is null or nullif(btrim(p_reason),'') is null then raise exception 'COUNT_AND_REASON_REQUIRED';end if;
  payload:=jsonb_build_object('conversion',p_conversion,'packs',p_packs,'counted',p_counted,'reason',btrim(p_reason),'expiry',p_expiry);
  perform pg_advisory_xact_lock(hashtextextended(c.business_id::text||p_request::text,0));
  select * into prior from public.bulk_count_overrides where business_id=c.business_id and request_id=p_request;
  if found then
    if prior.request_payload<>payload or prior.authorized_by<>auth.uid() then raise exception 'REQUEST_CONFLICT';end if;return prior.unpacking_id;
  end if;
  if exists(select 1 from public.bulk_unpackings where business_id=c.business_id and request_id=p_request) then raise exception 'REQUEST_CONFLICT';end if;
  perform product_id from public.stock where store_id=c.store_id and product_id in (c.pack_product_id,c.unit_product_id) order by product_id for update;
  select quantity into available from public.stock where product_id=c.pack_product_id and store_id=c.store_id;
  if available is null or available>=p_packs then raise exception 'NO_SHORTAGE_USE_NORMAL_UNPACK';end if;
  correction:=p_counted-available;
  select cost_price,track_expiry into cost,tracked from public.products where id=c.pack_product_id and is_active;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  if tracked and p_expiry is null then raise exception 'EXPIRY_DATE_REQUIRED';end if;
  insert into public.stock_adjustments(business_id,store_id,product_id,reason,quantity_before,quantity_after,delta,note,performed_by)
    values(c.business_id,c.store_id,c.pack_product_id,'STOCK_COUNT_CORRECTION',available,p_counted,correction,'Manager unpack override: '||btrim(p_reason),auth.uid()) returning id into aid;
  perform app.apply_stock_delta(c.business_id,c.store_id,c.pack_product_id,correction,'ADJUSTMENT_INCREASE','Manager unpack override: '||btrim(p_reason),'stock_adjustments',aid,cost);
  if tracked then perform app.put_stock_batches(c.pack_product_id,c.store_id,jsonb_build_array(jsonb_build_object('quantity',correction,'expiry_date',p_expiry,'batch_ref','Count override '||aid::text)));end if;
  uid:=public.unpack_stock(p_conversion,p_packs,btrim(p_reason),p_request);
  insert into public.bulk_count_overrides(business_id,store_id,unpacking_id,request_id,request_payload,quantity_before,counted_quantity,reason,authorized_by)
    values(c.business_id,c.store_id,uid,p_request,payload,available,p_counted,btrim(p_reason),auth.uid());
  perform app.audit('bulk.count_override','bulk_unpackings',uid,c.business_id,c.store_id,jsonb_build_object('quantity',available),jsonb_build_object('counted_quantity',p_counted,'adjustment_id',aid,'reason',p_reason));
  return uid;
end $$;
revoke execute on function public.unpack_stock_with_count(uuid,integer,integer,text,uuid,date) from public,anon;
grant execute on function public.unpack_stock_with_count(uuid,integer,integer,text,uuid,date) to authenticated;
