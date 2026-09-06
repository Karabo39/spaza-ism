create table public.stock_adjustment_requests (
  request_id uuid not null,business_id uuid not null references public.businesses(id),store_id uuid not null references public.stores(id),
  adjustment_id uuid not null references public.stock_adjustments(id),payload jsonb not null,performed_by uuid not null references auth.users(id),
  primary key(business_id,request_id)
);
alter table public.stock_adjustment_requests enable row level security;
revoke all on public.stock_adjustment_requests from public,anon,authenticated;
grant select on public.stock_adjustment_requests to authenticated;
create policy adjustment_requests_read on public.stock_adjustment_requests for select to authenticated using(app.has_store_role(store_id,'manager'));

create function app.adjust_stock_count(p_store uuid,p_product uuid,p_new_qty numeric,p_reason text,p_note text,p_expiry date,p_reference uuid default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare product public.products%rowtype; before_qty numeric; delta numeric; aid uuid; reason app.adjustment_reason; movement app.movement_type; b record; remaining numeric; taken numeric;
begin
  if p_new_qty is null or p_new_qty<0 or p_new_qty::text in ('NaN','Infinity','-Infinity') or p_new_qty<>round(p_new_qty,3) then raise exception 'INVALID_QUANTITY';end if;
  reason:=upper(p_reason)::app.adjustment_reason;if reason is null then raise exception 'REASON_REQUIRED';end if;
  select * into product from public.products where id=p_product and store_id=p_store and business_id=app.store_business(p_store) for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  insert into public.stock(product_id,store_id,quantity) values(p_product,p_store,0) on conflict do nothing;
  select quantity into before_qty from public.stock where product_id=p_product and store_id=p_store for update;
  delta:=p_new_qty-before_qty;if delta=0 then raise exception 'NO_CHANGE';end if;
  if delta>0 and reason in ('DAMAGED','EXPIRED','MISSING','THEFT') then raise exception 'LOSS_MUST_DECREASE_STOCK';end if;
  if delta>0 and product.track_expiry then
    if p_expiry is null then raise exception 'EXPIRY_DATE_REQUIRED';end if;
    perform app.put_stock_batches(p_product,p_store,jsonb_build_array(jsonb_build_object('quantity',delta,'expiry_date',p_expiry,'batch_ref','Count correction')));
  elsif delta<0 then
    if product.track_expiry and (p_expiry is not null or reason='EXPIRED') then
      remaining:=-delta;
      for b in select * from public.stock_batches where product_id=p_product and store_id=p_store and quantity>0
        and (p_expiry is null or expiry_date=p_expiry) and (reason<>'EXPIRED' or expiry_date<(now() at time zone 'Africa/Johannesburg')::date) order by expiry_date,created_at,id for update loop
        exit when remaining<=0;taken:=least(remaining,b.quantity);update public.stock_batches set quantity=quantity-taken where id=b.id;remaining:=remaining-taken;
      end loop;
      if remaining>0 then raise exception 'SELECTED_BATCH_QUANTITY_MISSING';end if;
    else perform app.take_stock_batches(p_product,p_store,-delta);end if;
  end if;
  movement:=case when p_reference is not null then 'STOCK_TAKE'::app.movement_type when reason='DAMAGED' then 'DAMAGED'::app.movement_type when reason='EXPIRED' then 'EXPIRED'::app.movement_type when delta>0 then 'ADJUSTMENT_INCREASE'::app.movement_type else 'ADJUSTMENT_DECREASE'::app.movement_type end;
  insert into public.stock_adjustments(business_id,store_id,product_id,reason,quantity_before,quantity_after,delta,note,performed_by)
    values(product.business_id,p_store,p_product,reason,before_qty,p_new_qty,delta,p_note,auth.uid()) returning id into aid;
  perform app.apply_stock_delta(product.business_id,p_store,p_product,delta,movement,'Adjustment: '||p_reason||coalesce(' - '||p_note,''),case when p_reference is null then 'stock_adjustments' else 'stock_take' end,coalesce(p_reference,aid),product.cost_price);
  perform app.audit('stock.adjust','stock_adjustments',aid,product.business_id,p_store,jsonb_build_object('product_id',p_product,'quantity',before_qty),jsonb_build_object('product_id',p_product,'quantity',p_new_qty,'reason',p_reason,'note',p_note));return aid;
end $$;
drop function public.adjust_stock(uuid,uuid,numeric,text,text);
create function public.adjust_stock(p_store uuid,p_product uuid,p_new_qty numeric,p_reason text,p_note text default null,p_expiry date default null,p_request uuid default null,p_expected numeric default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare biz uuid; payload jsonb; prior public.stock_adjustment_requests%rowtype; aid uuid; available numeric;
begin
  if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN';end if;biz:=app.store_business(p_store);
  payload:=jsonb_build_object('store',p_store,'product',p_product,'quantity',p_new_qty,'reason',p_reason,'note',p_note,'expiry',p_expiry,'expected',p_expected);
  if p_request is not null then
    perform pg_advisory_xact_lock(hashtextextended('adjust:'||biz::text||p_request::text,0));select * into prior from public.stock_adjustment_requests where business_id=biz and request_id=p_request;
    if found then if prior.payload<>payload or prior.performed_by<>auth.uid() then raise exception 'REQUEST_CONFLICT';end if;return prior.adjustment_id;end if;
  end if;
  perform 1 from public.products where id=p_product and store_id=p_store for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE';end if;
  select quantity into available from public.stock where product_id=p_product and store_id=p_store for update;
  if p_expected is not null and p_expected is distinct from coalesce(available,0) then raise exception 'STOCK_CHANGED_RECOUNT';end if;
  aid:=app.adjust_stock_count(p_store,p_product,p_new_qty,p_reason,p_note,p_expiry);
  if p_request is not null then insert into public.stock_adjustment_requests values(p_request,biz,p_store,aid,payload,auth.uid());end if;return aid;
end $$;

alter table public.stock_take_items add column counted_expiry date,add column counted_at timestamptz,add column counted_by uuid references auth.users(id);
revoke insert,update,delete on public.stock_takes,public.stock_take_items from authenticated;
create function public.save_stock_take_count(p_item uuid,p_quantity numeric,p_expiry date default null)
returns void language plpgsql security definer set search_path=public,app as $$
declare take public.stock_takes%rowtype; item public.stock_take_items%rowtype; current_qty numeric;
begin
  select st.* into take from public.stock_takes st join public.stock_take_items i on i.stock_take_id=st.id where i.id=p_item for update of st;
  if not found or not app.has_store_access(take.store_id) then raise exception 'FORBIDDEN';end if;
  if take.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED';end if;
  if p_quantity is not null and (p_quantity<0 or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<>round(p_quantity,3)) then raise exception 'INVALID_QUANTITY';end if;
  select * into item from public.stock_take_items where id=p_item for update;
  select quantity into current_qty from public.stock where product_id=item.product_id and store_id=take.store_id for share;
  current_qty:=coalesce(current_qty,0);
  if p_quantity>current_qty and p_expiry is null and exists(select 1 from public.products where id=item.product_id and track_expiry) then raise exception 'EXPIRY_DATE_REQUIRED';end if;
  update public.stock_take_items set system_qty=current_qty,counted_qty=p_quantity,counted=p_quantity is not null,variance=p_quantity-current_qty,counted_expiry=p_expiry,counted_at=now(),counted_by=auth.uid() where id=p_item;
  perform app.audit('stock_take.count','stock_take_items',p_item,take.business_id,take.store_id,to_jsonb(item),jsonb_build_object('product_id',item.product_id,'counted',p_quantity,'system',current_qty));
end $$;
create or replace function public.complete_stock_take(p_stock_take uuid)
returns void language plpgsql security definer set search_path=public,app as $$
declare take public.stock_takes%rowtype; item record; current_qty numeric;
begin
  select * into take from public.stock_takes where id=p_stock_take for update;
  if not found or not app.has_store_role(take.store_id,'manager') then raise exception 'FORBIDDEN';end if;
  if take.status='COMPLETED' then return;end if;
  if take.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED';end if;
  if not exists(select 1 from public.stock_take_items where stock_take_id=p_stock_take and counted) then raise exception 'NO_COUNTS';end if;
  for item in select * from public.stock_take_items where stock_take_id=p_stock_take and counted order by product_id for update loop
    perform 1 from public.products where id=item.product_id for update;
    select quantity into current_qty from public.stock where product_id=item.product_id and store_id=take.store_id for update;
    if item.counted_at is null or coalesce(current_qty,0)<>item.system_qty then raise exception 'STOCK_CHANGED_RECOUNT: %',item.product_id;end if;
    if item.counted_qty<>item.system_qty then perform app.adjust_stock_count(take.store_id,item.product_id,item.counted_qty,'STOCK_COUNT_CORRECTION','Stock take '||p_stock_take::text,item.counted_expiry,p_stock_take);end if;
  end loop;
  update public.stock_takes set status='COMPLETED',approved_by=auth.uid(),completed_at=now() where id=p_stock_take;
  perform app.audit('stock_take.complete','stock_take',p_stock_take,take.business_id,take.store_id,null,null);
end $$;
create function public.cancel_stock_take(p_stock_take uuid,p_reason text) returns void language plpgsql security definer set search_path=public,app as $$
declare take public.stock_takes%rowtype;
begin
  select * into take from public.stock_takes where id=p_stock_take for update;
  if not found or not app.has_store_access(take.store_id) or (take.started_by is distinct from auth.uid() and not app.has_store_role(take.store_id,'manager')) then raise exception 'FORBIDDEN';end if;
  if take.status='CANCELLED' then return;end if;
  if take.status<>'IN_PROGRESS' then raise exception 'STOCK_TAKE_CLOSED';end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED';end if;
  update public.stock_takes set status='CANCELLED',note=concat_ws(E'\n',note,'Cancelled: '||btrim(p_reason)) where id=p_stock_take;
  perform app.audit('stock_take.cancel','stock_take',p_stock_take,take.business_id,take.store_id,null,jsonb_build_object('reason',p_reason));
end $$;
revoke execute on function app.adjust_stock_count(uuid,uuid,numeric,text,text,date,uuid) from public,anon,authenticated;
revoke execute on function public.adjust_stock(uuid,uuid,numeric,text,text,date,uuid,numeric),public.save_stock_take_count(uuid,numeric,date),public.cancel_stock_take(uuid,text) from public,anon;
grant execute on function public.adjust_stock(uuid,uuid,numeric,text,text,date,uuid,numeric),public.save_stock_take_count(uuid,numeric,date),public.cancel_stock_take(uuid,text) to authenticated;
