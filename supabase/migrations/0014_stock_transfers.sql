-- Linked transfer lifecycle. Stock leaves at dispatch and lands only at receipt.
create table public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  source_id uuid not null,
  destination_id uuid not null,
  reference text not null unique default ('TR-' || upper(replace(gen_random_uuid()::text,'-',''))),
  status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','DISPATCHED','RECEIVED','CANCELLED')),
  note text, cancellation_reason text,
  created_by uuid not null references auth.users(id),
  dispatched_by uuid references auth.users(id), received_by uuid references auth.users(id),
  created_at timestamptz not null default now(), submitted_at timestamptz, dispatched_at timestamptz, received_at timestamptz, cancelled_at timestamptz,
  request_id uuid not null, request_payload jsonb not null,
  unique(business_id, request_id), check(source_id <> destination_id),
  foreign key(source_id,business_id) references public.stores(id,business_id),
  foreign key(destination_id,business_id) references public.stores(id,business_id)
);
create index stock_transfers_source on public.stock_transfers(source_id,created_at desc);
create index stock_transfers_destination on public.stock_transfers(destination_id,created_at desc);
create table public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.stock_transfers(id),
  source_product_id uuid not null references public.products(id),
  destination_product_id uuid not null references public.products(id),
  source_name text not null, destination_name text not null,
  quantity numeric(14,3) not null check(quantity>0 and quantity::text <> 'NaN'),
  unit_cost numeric(14,2) not null check(unit_cost>=0),
  batches jsonb not null default '[]',
  unique(transfer_id,source_product_id,destination_product_id)
);
create index transfer_items_source_product on public.stock_transfer_items(source_product_id);
create index transfer_items_destination_product on public.stock_transfer_items(destination_product_id);
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
revoke all on public.stock_transfers, public.stock_transfer_items from public,anon,authenticated;
grant select on public.stock_transfers, public.stock_transfer_items to authenticated;
create policy sel_transfers on public.stock_transfers for select to authenticated
  using(app.has_store_access(source_id) and app.has_store_access(destination_id));
create policy sel_transfer_items on public.stock_transfer_items for select to authenticated
  using(exists(select 1 from public.stock_transfers t where t.id=transfer_id));

-- Batch allocations travel with the transfer and are restored on cancellation.
create function app.take_stock_batches(p_product uuid,p_store uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path=public,app as $$
declare b record; remaining numeric:=p_quantity; taken numeric; result jsonb:='[]';
begin
  for b in select * from public.stock_batches where product_id=p_product and store_id=p_store and quantity>0
    order by expiry_date nulls last,created_at,id for update
  loop
    exit when remaining<=0;
    taken:=least(remaining,b.quantity);
    update public.stock_batches set quantity=quantity-taken where id=b.id;
    result:=result || jsonb_build_array(jsonb_build_object('quantity',taken,'expiry_date',b.expiry_date,'batch_ref',b.batch_ref));
    remaining:=remaining-taken;
  end loop;
  if remaining>0 and exists(select 1 from public.products where id=p_product and track_expiry) then
    raise exception 'BATCH_QUANTITY_MISSING';
  end if;
  return result;
end $$;
create function app.put_stock_batches(p_product uuid,p_store uuid,p_batches jsonb,p_multiplier numeric default 1)
returns void language plpgsql security definer set search_path=public,app as $$
begin
  insert into public.stock_batches(product_id,store_id,quantity,expiry_date,batch_ref)
    select p_product,p_store,(b->>'quantity')::numeric*p_multiplier,(b->>'expiry_date')::date,b->>'batch_ref'
    from jsonb_array_elements(p_batches) b;
end $$;

create function public.create_stock_transfer(p_source uuid,p_destination uuid,p_items jsonb,p_request uuid,p_note text default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare biz uuid; tid uuid; existing public.stock_transfers%rowtype; item jsonb; src public.products%rowtype; dest public.products%rowtype; q numeric; payload jsonb;
begin
  if not app.has_store_access(p_source) or not app.has_store_access(p_destination) then raise exception 'FORBIDDEN'; end if;
  biz:=app.store_business(p_source);
  if p_source=p_destination or biz is distinct from app.store_business(p_destination) then raise exception 'INVALID_LOCATION'; end if;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'NO_ITEMS'; end if;
  if jsonb_array_length(p_items) not between 1 and 200 then raise exception 'NO_ITEMS'; end if;
  payload:=jsonb_build_object('source',p_source,'destination',p_destination,'items',p_items,'note',p_note);
  perform pg_advisory_xact_lock(hashtextextended(biz::text||p_request::text,0));
  select * into existing from public.stock_transfers where business_id=biz and request_id=p_request;
  if found then
    if existing.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if;
    return existing.id;
  end if;
  insert into public.stock_transfers(business_id,source_id,destination_id,created_by,request_id,request_payload,note)
    values(biz,p_source,p_destination,auth.uid(),p_request,payload,p_note) returning id into tid;
  for item in select * from jsonb_array_elements(p_items) loop
    q:=(item->>'quantity')::numeric;
    if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) then raise exception 'INVALID_QUANTITY'; end if;
    select * into src from public.products where id=(item->>'source_product_id')::uuid and store_id=p_source and business_id=biz and is_active;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    select * into dest from public.products where id=(item->>'destination_product_id')::uuid and store_id=p_destination and business_id=biz and is_active;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    if src.unit<>dest.unit or src.track_expiry<>dest.track_expiry then raise exception 'PRODUCT_UNITS_MISMATCH'; end if;
    insert into public.stock_transfer_items(transfer_id,source_product_id,destination_product_id,source_name,destination_name,quantity,unit_cost)
      values(tid,src.id,dest.id,src.name,dest.name,q,src.cost_price);
  end loop;
  perform app.audit('transfer.create','stock_transfers',tid,biz,p_source,null,jsonb_build_object('destination',p_destination,'items',p_items));
  return tid;
end $$;

create function public.process_stock_transfer(p_transfer uuid,p_action text,p_reason text default null)
returns text language plpgsql security definer set search_path=public,app as $$
declare t public.stock_transfers%rowtype; item record; next_status text; allocations jsonb;
begin
  select * into t from public.stock_transfers where id=p_transfer for update;
  if not found or not app.has_store_access(t.source_id) or not app.has_store_access(t.destination_id) then raise exception 'FORBIDDEN'; end if;
  next_status:=case p_action when 'submit' then 'SUBMITTED' when 'dispatch' then 'DISPATCHED' when 'receive' then 'RECEIVED' when 'cancel' then 'CANCELLED' else null end;
  if next_status is null then raise exception 'INVALID_ACTION'; end if;
  if t.status=next_status then return t.status; end if;
  if not ((p_action='submit' and t.status='DRAFT') or (p_action='dispatch' and t.status='SUBMITTED') or
    (p_action='receive' and t.status='DISPATCHED') or (p_action='cancel' and t.status in ('DRAFT','SUBMITTED','DISPATCHED'))) then raise exception 'INVALID_TRANSFER_STATE'; end if;
  if p_action='cancel' and nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  -- Lock all involved stock rows in a stable order before any movements.
  perform s.id from public.stock s where
    (s.store_id=t.source_id and s.product_id in (select source_product_id from public.stock_transfer_items where transfer_id=t.id)) or
    (s.store_id=t.destination_id and s.product_id in (select destination_product_id from public.stock_transfer_items where transfer_id=t.id))
    order by s.store_id,s.product_id for update;
  if p_action in ('submit','dispatch') then
    if exists(select 1 from public.stock_transfer_items i join public.products p on p.id=i.source_product_id
      join public.products d on d.id=i.destination_product_id where i.transfer_id=t.id and (not p.is_active or not d.is_active or p.unit<>d.unit or p.track_expiry<>d.track_expiry))
      then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    if exists(select 1 from (select source_product_id,sum(quantity) quantity from public.stock_transfer_items where transfer_id=t.id group by source_product_id) i
      left join public.stock s on s.product_id=i.source_product_id and s.store_id=t.source_id where coalesce(s.quantity,0)<i.quantity)
      then raise exception 'INSUFFICIENT_STOCK'; end if;
  end if;
  for item in select * from public.stock_transfer_items where transfer_id=t.id order by source_product_id,destination_product_id loop
    if p_action='dispatch' then
      perform app.apply_stock_delta(t.business_id,t.source_id,item.source_product_id,-item.quantity,'TRANSFER_OUT',t.reference,'stock_transfers',t.id,item.unit_cost);
      allocations:=app.take_stock_batches(item.source_product_id,t.source_id,item.quantity);
      update public.stock_transfer_items set batches=allocations where id=item.id;
    elsif p_action='receive' then
      perform app.apply_stock_delta(t.business_id,t.destination_id,item.destination_product_id,item.quantity,'TRANSFER_IN',t.reference,'stock_transfers',t.id,item.unit_cost);
      perform app.put_stock_batches(item.destination_product_id,t.destination_id,item.batches);
    elsif p_action='cancel' and t.status='DISPATCHED' then
      perform app.apply_stock_delta(t.business_id,t.source_id,item.source_product_id,item.quantity,'TRANSFER_IN',t.reference||' cancelled: '||p_reason,'stock_transfers',t.id,item.unit_cost);
      perform app.put_stock_batches(item.source_product_id,t.source_id,item.batches);
    end if;
  end loop;
  update public.stock_transfers set status=next_status,
    submitted_at=case when p_action='submit' then now() else submitted_at end,
    dispatched_at=case when p_action='dispatch' then now() else dispatched_at end,
    dispatched_by=case when p_action='dispatch' then auth.uid() else dispatched_by end,
    received_at=case when p_action='receive' then now() else received_at end,
    received_by=case when p_action='receive' then auth.uid() else received_by end,
    cancelled_at=case when p_action='cancel' then now() else cancelled_at end,
    cancellation_reason=case when p_action='cancel' then btrim(p_reason) else cancellation_reason end
    where id=t.id;
  perform app.audit('transfer.'||p_action,'stock_transfers',t.id,t.business_id,t.source_id,jsonb_build_object('status',t.status),jsonb_build_object('status',next_status,'reason',p_reason,'destination',t.destination_id));
  return next_status;
end $$;
revoke execute on function app.take_stock_batches(uuid,uuid,numeric),app.put_stock_batches(uuid,uuid,jsonb,numeric) from public,anon,authenticated;
revoke execute on function public.create_stock_transfer(uuid,uuid,jsonb,uuid,text),public.process_stock_transfer(uuid,text,text) from public,anon;
grant execute on function public.create_stock_transfer(uuid,uuid,jsonb,uuid,text),public.process_stock_transfer(uuid,text,text) to authenticated;
