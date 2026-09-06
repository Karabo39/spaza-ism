create table public.goods_returns (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), store_id uuid not null references public.stores(id),
  invoice_id uuid references public.sales_invoices(id), sale_id uuid references public.goods_out(id), customer_id uuid references public.customers(id),
  reference text not null unique default ('RET-'||upper(replace(gen_random_uuid()::text,'-',''))),
  status text not null default 'SUBMITTED' check(status in ('SUBMITTED','APPROVED','REJECTED')),
  reason text not null check(length(btrim(reason))>0), inspection text not null check(length(btrim(inspection))>0),
  amount numeric(14,2) not null default 0, credit_entry_id uuid references public.invoice_entries(id),
  created_by uuid not null references auth.users(id), approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(), processed_at timestamptz, decision_reason text,
  request_id uuid not null, request_payload jsonb not null, unique(business_id,request_id),
  check((invoice_id is not null)::int+(sale_id is not null)::int=1)
);
create index goods_returns_location on public.goods_returns(store_id,created_at desc);
create index goods_returns_invoice on public.goods_returns(invoice_id);
create index goods_returns_sale on public.goods_returns(sale_id);
create table public.goods_return_items (
  id uuid primary key default gen_random_uuid(), return_id uuid not null references public.goods_returns(id),
  invoice_item_id uuid references public.sales_invoice_items(id), sale_item_id uuid references public.goods_out_items(id),
  product_id uuid not null references public.products(id), product_name text not null,
  quantity numeric(14,3) not null check(quantity>0 and quantity::text<>'NaN'), amount numeric(14,2) not null,
  condition text not null check(condition in ('GOOD','DAMAGED','EXPIRED','OTHER')),
  inventory_action text not null check(inventory_action in ('RETURN_TO_STOCK','QUARANTINE','SUPPLIER_RETURN','WRITE_OFF')),
  expiry_date date, unique(return_id,product_id), check((invoice_item_id is not null)::int+(sale_item_id is not null)::int=1)
);
create index return_items_invoice_source on public.goods_return_items(invoice_item_id);
create index return_items_sale_source on public.goods_return_items(sale_item_id);
create table public.return_dispositions (
  id uuid primary key default gen_random_uuid(), return_item_id uuid not null unique references public.goods_return_items(id),
  action text not null check(action in ('RETURN_TO_STOCK','SUPPLIER_RETURN','WRITE_OFF')), reason text not null check(length(btrim(reason))>0),
  expiry_date date, performed_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.customer_refunds (
  id uuid primary key default gen_random_uuid(), return_id uuid not null references public.goods_returns(id),
  business_id uuid not null references public.businesses(id), store_id uuid not null references public.stores(id),
  reference text not null unique default ('REF-'||upper(replace(gen_random_uuid()::text,'-',''))),
  amount numeric(14,2) not null check(amount>0 and amount::text<>'NaN'), method text not null check(method in ('CASH','CARD_EFT')),
  payment_reference text, reason text not null, performed_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  request_id uuid not null, request_payload jsonb not null, unique(business_id,request_id)
);
create index customer_refunds_return on public.customer_refunds(return_id);
create trigger return_items_append_only before update or delete on public.goods_return_items for each row execute function app.block_mutation();
create trigger dispositions_append_only before update or delete on public.return_dispositions for each row execute function app.block_mutation();
create trigger refunds_append_only before update or delete on public.customer_refunds for each row execute function app.block_mutation();
do $$ declare t text; begin
  foreach t in array array['goods_returns','goods_return_items','return_dispositions','customer_refunds'] loop
    execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from public,anon,authenticated',t); execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
create policy goods_returns_read on public.goods_returns for select to authenticated using(app.has_store_access(store_id));
create policy return_items_read on public.goods_return_items for select to authenticated using(exists(select 1 from public.goods_returns r where r.id=return_id));
create policy dispositions_read on public.return_dispositions for select to authenticated using(exists(select 1 from public.goods_return_items ri where ri.id=return_item_id));
create policy refunds_read on public.customer_refunds for select to authenticated using(app.has_store_access(store_id));

create function app.approve_goods_return(p_return uuid)
returns void language plpgsql security definer set search_path=public,app as $$
declare r public.goods_returns%rowtype; line record; eid uuid; available numeric;
begin
  -- Caller holds original sale/invoice and return locks, and has checked permissions.
  select * into r from public.goods_returns where id=p_return;
  if r.invoice_id is not null then
    select total+debits-credits into available from public.v_invoice_balances where id=r.invoice_id and state='ISSUED';
    if available is null or r.amount>available then raise exception 'CREDIT_EXCEEDS_INVOICE'; end if;
    insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,reason,performed_by,request_id,request_payload)
      values(r.invoice_id,r.business_id,r.store_id,'CREDIT_NOTE',r.amount,r.reference||': '||r.reason,auth.uid(),gen_random_uuid(),jsonb_build_object('return',r.id)) returning id into eid;
  end if;
  if r.customer_id is not null then
    perform app.post_customer_entry(r.customer_id,-r.amount,'ADJUSTMENT',case when eid is null then 'goods_returns' else 'invoice_entries' end,coalesce(eid,r.id),'Return '||r.reference||': '||r.reason);
  end if;
  for line in select * from public.goods_return_items where return_id=r.id order by product_id loop
    if line.inventory_action='RETURN_TO_STOCK' then
      perform app.apply_stock_delta(r.business_id,r.store_id,line.product_id,line.quantity,'RETURN_IN',r.reference||': '||r.reason,'goods_returns',r.id);
      perform app.put_stock_batches(line.product_id,r.store_id,jsonb_build_array(jsonb_build_object('quantity',line.quantity,'expiry_date',line.expiry_date,'batch_ref',r.reference)));
    end if;
  end loop;
  update public.goods_returns set status='APPROVED',approved_by=auth.uid(),processed_at=now(),credit_entry_id=eid where id=r.id;
  perform app.audit('return.approve','goods_returns',r.id,r.business_id,r.store_id,null,jsonb_build_object('amount',r.amount,'credit_entry',eid));
end $$;
revoke execute on function app.approve_goods_return(uuid) from public,anon,authenticated;

create function public.submit_goods_return(p_source_type text,p_source uuid,p_items jsonb,p_reason text,p_inspection text,p_request uuid)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare loc uuid; biz uuid; customer uuid; rid uuid; payload jsonb; old public.goods_returns%rowtype; item jsonb; source record;
  q numeric; previous_qty numeric; previous_amount numeric; amount numeric; total numeric:=0; tracked boolean; expiry date;
begin
  if p_source_type='invoice' then
    select store_id,business_id,customer_id into loc,biz,customer from public.sales_invoices where id=p_source and state='ISSUED' and goods_issued_at is not null for update;
  elsif p_source_type='sale' then
    select store_id,business_id,customer_id into loc,biz,customer from public.goods_out where id=p_source for update;
  else raise exception 'INVALID_SOURCE'; end if;
  if loc is null or not app.has_store_access(loc) then raise exception 'FORBIDDEN'; end if;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  payload:=jsonb_build_object('user',auth.uid(),'source_type',p_source_type,'source',p_source,'items',p_items,'reason',p_reason,'inspection',p_inspection);
  perform pg_advisory_xact_lock(hashtextextended(biz::text||p_request::text,0));
  select * into old from public.goods_returns where business_id=biz and request_id=p_request;
  if found then if old.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return old.id; end if;
  if nullif(btrim(p_reason),'') is null or nullif(btrim(p_inspection),'') is null then raise exception 'REASON_AND_INSPECTION_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'NO_ITEMS'; end if;
  insert into public.goods_returns(business_id,store_id,invoice_id,sale_id,customer_id,reason,inspection,created_by,request_id,request_payload)
    values(biz,loc,case when p_source_type='invoice' then p_source end,case when p_source_type='sale' then p_source end,customer,p_reason,p_inspection,auth.uid(),p_request,payload) returning id into rid;
  for item in select value from jsonb_array_elements(p_items) loop
    if p_source_type='invoice' then
      select id,product_id,product_name,quantity,net_total as amount into source from public.sales_invoice_items where invoice_id=p_source and id=(item->>'item_id')::uuid;
    else
      select si.id,si.product_id,p.name product_name,si.quantity,si.line_total as amount into source from public.goods_out_items si join public.products p on p.id=si.product_id where goods_out_id=p_source and si.id=(item->>'item_id')::uuid;
    end if;
    if not found then raise exception 'INVALID_RETURN_ITEM'; end if;
    q:=(item->>'quantity')::numeric;
    if q is null or q<=0 or q::text in ('NaN','Infinity','-Infinity') or q<>round(q,3) then raise exception 'INVALID_QUANTITY'; end if;
    select coalesce(sum(ri.quantity),0),coalesce(sum(ri.amount),0) into previous_qty,previous_amount from public.goods_return_items ri join public.goods_returns r on r.id=ri.return_id
      where r.status<>'REJECTED' and (ri.invoice_item_id=source.id or ri.sale_item_id=source.id);
    if previous_qty+q>source.quantity then raise exception 'RETURN_EXCEEDS_SOLD_QUANTITY'; end if;
    if item->>'condition' is null or item->>'condition' not in ('GOOD','DAMAGED','EXPIRED','OTHER') or item->>'action' is null or item->>'action' not in ('RETURN_TO_STOCK','QUARANTINE','SUPPLIER_RETURN','WRITE_OFF') then raise exception 'INVALID_RETURN_CONDITION'; end if;
    expiry:=(item->>'expiry_date')::date;
    select track_expiry into tracked from public.products where id=source.product_id;
    if item->>'action'='RETURN_TO_STOCK' then
      if item->>'condition'<>'GOOD' or (expiry is not null and expiry<(now() at time zone 'Africa/Johannesburg')::date) then raise exception 'RETURN_REQUIRES_QUARANTINE'; end if;
      if tracked and expiry is null then raise exception 'EXPIRY_REQUIRED'; end if;
    end if;
    amount:=case when previous_qty+q=source.quantity then source.amount-previous_amount else least(round(source.amount*q/source.quantity,2),source.amount-previous_amount) end;
    total:=total+amount;
    insert into public.goods_return_items(return_id,invoice_item_id,sale_item_id,product_id,product_name,quantity,amount,condition,inventory_action,expiry_date)
      values(rid,case when p_source_type='invoice' then source.id end,case when p_source_type='sale' then source.id end,source.product_id,source.product_name,q,amount,item->>'condition',item->>'action',expiry);
  end loop;
  update public.goods_returns set amount=total where id=rid;
  perform app.audit('return.submit','goods_returns',rid,biz,loc,null,payload);
  if not coalesce((select return_approval_required from public.billing_settings where business_id=biz),true) then perform app.approve_goods_return(rid); end if;
  return rid;
end $$;

create function public.process_goods_return(p_return uuid,p_approve boolean,p_reason text default null)
returns text language plpgsql security definer set search_path=public,app as $$
declare r public.goods_returns%rowtype;
begin
  select * into r from public.goods_returns where id=p_return;
  if not found or not app.has_store_role(r.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  if r.invoice_id is not null then perform 1 from public.sales_invoices where id=r.invoice_id for update;
  else perform 1 from public.goods_out where id=r.sale_id for update; end if;
  select * into r from public.goods_returns where id=p_return for update;
  if p_approve is null then raise exception 'INVALID_ACTION'; end if;
  if r.status=(case when p_approve then 'APPROVED' else 'REJECTED' end) then return r.status; end if;
  if r.status<>'SUBMITTED' then raise exception 'INVALID_RETURN_STATE'; end if;
  if p_approve then perform app.approve_goods_return(r.id);
  else
    if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
    update public.goods_returns set status='REJECTED',approved_by=auth.uid(),processed_at=now(),decision_reason=p_reason where id=r.id;
    perform app.audit('return.reject','goods_returns',r.id,r.business_id,r.store_id,null,jsonb_build_object('reason',p_reason));
  end if;
  return case when p_approve then 'APPROVED' else 'REJECTED' end;
end $$;

create function public.resolve_return_quarantine(p_item uuid,p_action text,p_reason text,p_expiry date default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare line public.goods_return_items%rowtype; r public.goods_returns%rowtype; previous public.return_dispositions%rowtype; result uuid;
begin
  select * into line from public.goods_return_items where id=p_item for update;
  select * into r from public.goods_returns where id=line.return_id;
  if r.id is null or not app.has_store_role(r.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  if r.status<>'APPROVED' or line.inventory_action<>'QUARANTINE' then raise exception 'INVALID_RETURN_STATE'; end if;
  select * into previous from public.return_dispositions where return_item_id=line.id;
  if found then
    if previous.action is distinct from p_action or previous.reason is distinct from p_reason or previous.expiry_date is distinct from p_expiry then raise exception 'REQUEST_CONFLICT'; end if; return previous.id;
  end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  if p_action is null or p_action not in ('RETURN_TO_STOCK','SUPPLIER_RETURN','WRITE_OFF') then raise exception 'INVALID_ACTION'; end if;
  if p_action='RETURN_TO_STOCK' then
    if p_expiry<(now() at time zone 'Africa/Johannesburg')::date then raise exception 'RETURN_REQUIRES_QUARANTINE'; end if;
    if p_expiry is null and exists(select 1 from public.products where id=line.product_id and track_expiry) then raise exception 'EXPIRY_REQUIRED'; end if;
    perform app.apply_stock_delta(r.business_id,r.store_id,line.product_id,line.quantity,'RETURN_IN',r.reference||': '||p_reason,'goods_returns',r.id);
    perform app.put_stock_batches(line.product_id,r.store_id,jsonb_build_array(jsonb_build_object('quantity',line.quantity,'expiry_date',p_expiry,'batch_ref',r.reference)));
  end if;
  insert into public.return_dispositions(return_item_id,action,reason,expiry_date,performed_by) values(line.id,p_action,p_reason,p_expiry,auth.uid()) returning id into result;
  perform app.audit('return.disposition','return_dispositions',result,r.business_id,r.store_id,null,jsonb_build_object('action',p_action,'reason',p_reason));
  return result;
end $$;

create function public.record_customer_refund(p_return uuid,p_amount numeric,p_method text,p_reason text,p_request uuid,p_reference text default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare r public.goods_returns%rowtype; old public.customer_refunds%rowtype; payload jsonb; available numeric; refunded numeric; balance numeric; fid uuid;
begin
  select * into r from public.goods_returns where id=p_return;
  if not found or not app.has_store_role(r.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  if r.invoice_id is not null then perform 1 from public.sales_invoices where id=r.invoice_id for update;
  else perform 1 from public.goods_out where id=r.sale_id for update; end if;
  select * into r from public.goods_returns where id=p_return for update;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  payload:=jsonb_build_object('return',r.id,'amount',p_amount,'method',p_method,'reason',p_reason,'reference',p_reference,'user',auth.uid());
  perform pg_advisory_xact_lock(hashtextextended(r.business_id::text||p_request::text,0));
  select * into old from public.customer_refunds where business_id=r.business_id and request_id=p_request;
  if found then if old.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return old.id; end if;
  if r.status<>'APPROVED' then raise exception 'RETURN_APPROVAL_REQUIRED'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<=0 then raise exception 'INVALID_AMOUNT'; end if;
  p_amount:=round(p_amount,2);
  if p_method is null or p_method not in ('CASH','CARD_EFT') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  select coalesce(sum(amount),0) into refunded from public.customer_refunds where return_id=r.id;
  available:=r.amount-refunded;
  if r.invoice_id is not null then
    select coalesce(sum(f.amount),0) into refunded from public.customer_refunds f join public.goods_returns gr on gr.id=f.return_id where gr.invoice_id=r.invoice_id;
    available:=least(available,(select greatest(-outstanding,0) from public.v_invoice_balances where id=r.invoice_id)-refunded);
  end if;
  if r.customer_id is not null then
    select a.balance into balance from public.credit_accounts a where customer_id=r.customer_id for update;
    available:=least(available,greatest(-balance,0));
  end if;
  if p_amount>available then raise exception 'REFUND_EXCEEDS_AVAILABLE_CREDIT'; end if;
  insert into public.customer_refunds(return_id,business_id,store_id,amount,method,payment_reference,reason,performed_by,request_id,request_payload)
    values(r.id,r.business_id,r.store_id,p_amount,p_method,p_reference,p_reason,auth.uid(),p_request,payload) returning id into fid;
  if r.customer_id is not null then perform app.post_customer_entry(r.customer_id,p_amount,'ADJUSTMENT','customer_refunds',fid,'Refund '||r.reference||': '||p_reason); end if;
  perform app.audit('return.refund','customer_refunds',fid,r.business_id,r.store_id,null,payload);
  return fid;
end $$;
do $$ declare sig regprocedure; begin
  for sig in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('submit_goods_return','process_goods_return','resolve_return_quarantine','record_customer_refund') loop
    execute format('revoke execute on function %s from public,anon',sig); execute format('grant execute on function %s to authenticated',sig);
  end loop;
end $$;
