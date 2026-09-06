create function app.protect_posted_invoice()
returns trigger language plpgsql set search_path=public,app as $$
begin
  if tg_op='DELETE' then raise exception 'INVOICE_DELETE_FORBIDDEN'; end if;
  if old.state<>'DRAFT' and (to_jsonb(new)-array['state','cancellation_reason','goods_issued_at','goods_issued_by','authorized_by'])
    is distinct from (to_jsonb(old)-array['state','cancellation_reason','goods_issued_at','goods_issued_by','authorized_by']) then raise exception 'POSTED_INVOICE_IMMUTABLE'; end if;
  return new;
end $$;
create trigger protect_posted_invoice before update or delete on public.sales_invoices for each row execute function app.protect_posted_invoice();

create function public.post_invoice_entry(p_invoice uuid,p_kind text,p_amount numeric,p_request uuid,p_method text default null,p_reference text default null,p_reason text default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare i public.sales_invoices%rowtype; b public.v_invoice_balances%rowtype; previous public.invoice_entries%rowtype; eid uuid; payload jsonb; delta numeric;
begin
  select * into i from public.sales_invoices where id=p_invoice for update;
  if not found or not app.has_store_access(i.store_id) then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('PAYMENT','CREDIT_NOTE','DEBIT_NOTE') then raise exception 'INVALID_ACTION'; end if;
  if p_kind<>'PAYMENT' and not app.has_store_role(i.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  payload:=jsonb_build_object('user',auth.uid(),'invoice',i.id,'kind',p_kind,'amount',p_amount,'method',p_method,'reference',p_reference,'reason',p_reason);
  perform pg_advisory_xact_lock(hashtextextended(i.business_id::text||p_request::text,0));
  select * into previous from public.invoice_entries where business_id=i.business_id and request_id=p_request;
  if found then if previous.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return previous.id; end if;
  if i.state<>'ISSUED' then raise exception 'INVALID_INVOICE_STATE'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<=0 then raise exception 'INVALID_AMOUNT'; end if;
  p_amount:=round(p_amount,2);
  select * into b from public.v_invoice_balances where id=i.id;
  if p_kind='PAYMENT' then
    if p_method is null or p_method not in ('CASH','CARD_EFT') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
    if p_amount>b.outstanding then raise exception 'PAYMENT_EXCEEDS_OUTSTANDING'; end if;
  else
    if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
    if p_kind='CREDIT_NOTE' and p_amount>i.total+b.debits-b.credits then raise exception 'CREDIT_EXCEEDS_INVOICE'; end if;
    if p_method is not null then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  end if;
  delta:=case when p_kind='DEBIT_NOTE' then p_amount else -p_amount end;
  insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,method,payment_reference,reason,performed_by,request_id,request_payload)
    values(i.id,i.business_id,i.store_id,p_kind,p_amount,p_method,p_reference,p_reason,auth.uid(),p_request,payload) returning id into eid;
  perform app.post_customer_entry(i.customer_id,delta,case when p_kind='PAYMENT' then 'PAYMENT'::app.credit_txn_type else 'ADJUSTMENT'::app.credit_txn_type end,'invoice_entries',eid,p_kind||' '||i.reference||coalesce(': '||p_reason,''));
  perform app.audit('invoice.'||lower(p_kind),'invoice_entries',eid,i.business_id,i.store_id,null,payload);
  return eid;
end $$;

create function public.issue_invoice_goods(p_invoice uuid,p_override boolean default false,p_override_token uuid default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare i public.sales_invoices%rowtype; b public.v_invoice_balances%rowtype; a public.credit_accounts%rowtype; line record; approver uuid; allocations jsonb; movement app.movement_type;
begin
  select * into i from public.sales_invoices where id=p_invoice for update;
  if not found or not app.has_store_access(i.store_id) then raise exception 'FORBIDDEN'; end if;
  if i.goods_issued_at is not null then return i.id; end if;
  if i.state<>'ISSUED' then raise exception 'INVALID_INVOICE_STATE'; end if;
  if exists(select 1 from public.stores where id=i.store_id and location_type='warehouse') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
  select * into b from public.v_invoice_balances where id=i.id;
  if b.credits>0 then raise exception 'CREDITED_INVOICE_CANNOT_ISSUE_GOODS'; end if;
  select * into a from public.credit_accounts where customer_id=i.customer_id for update;
  if b.outstanding>0 then
    if i.terms<>'CREDIT' then raise exception 'INVOICE_PAYMENT_REQUIRED'; end if;
    if a.balance>a.credit_limit then
      if app.has_store_role(i.store_id,'manager') and coalesce(p_override,false) then approver:=auth.uid();
      else approver:=app.consume_credit_override(p_override_token,i.store_id,i.customer_id,b.outstanding); end if;
    end if;
  end if;
  movement:=case when i.terms='CREDIT' then 'SALE_CREDIT' when i.terms='CARD_EFT' then 'SALE_CARD' else 'SALE_CASH' end;
  for line in select * from public.sales_invoice_items where invoice_id=i.id order by product_id loop
    if not exists(select 1 from public.products where id=line.product_id and store_id=i.store_id and is_active) then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE'; end if;
    perform app.apply_stock_delta(i.business_id,i.store_id,line.product_id,-line.quantity,movement,i.reference,'sales_invoices',i.id,line.cost_price);
    allocations:=app.take_stock_batches(line.product_id,i.store_id,line.quantity);
    update public.sales_invoice_items set batches=allocations where id=line.id;
  end loop;
  update public.sales_invoices set goods_issued_at=now(),goods_issued_by=auth.uid(),authorized_by=approver where id=i.id;
  perform app.audit('invoice.goods_issue','sales_invoices',i.id,i.business_id,i.store_id,null,jsonb_build_object('authorized_by',approver,'outstanding',b.outstanding));
  return i.id;
end $$;

create function public.cancel_sales_invoice(p_invoice uuid,p_reason text)
returns text language plpgsql security definer set search_path=public,app as $$
declare i public.sales_invoices%rowtype; eid uuid; nextstate text;
begin
  select * into i from public.sales_invoices where id=p_invoice for update;
  if not found or not app.has_store_role(i.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
  if i.state in ('CANCELLED','VOID') then return i.state; end if;
  if i.goods_issued_at is not null or exists(select 1 from public.invoice_entries where invoice_id=i.id and kind<>'ISSUE') then raise exception 'USE_CREDIT_NOTE_OR_RETURN'; end if;
  nextstate:=case when i.state='DRAFT' then 'CANCELLED' else 'VOID' end;
  if nextstate='VOID' then
    insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,reason,performed_by,request_id,request_payload)
      values(i.id,i.business_id,i.store_id,'VOID',i.total,p_reason,auth.uid(),gen_random_uuid(),'{}') returning id into eid;
    perform app.post_customer_entry(i.customer_id,-i.total,'ADJUSTMENT','invoice_entries',eid,'Void '||i.reference||': '||p_reason);
  end if;
  update public.sales_invoices set state=nextstate,cancellation_reason=p_reason where id=i.id;
  perform app.audit('invoice.cancel','sales_invoices',i.id,i.business_id,i.store_id,null,jsonb_build_object('reason',p_reason,'state',nextstate));
  return nextstate;
end $$;

-- Payments against invoiced debt must identify their invoice so both ledgers agree.
create or replace function public.record_credit_payment(p_customer uuid,p_amount numeric,p_note text default null)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare a public.credit_accounts%rowtype; tid uuid;
begin
  select * into a from public.credit_accounts where customer_id=p_customer for update;
  if not found or not app.has_store_access(a.store_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.v_invoice_balances where customer_id=p_customer and outstanding>0) then raise exception 'SELECT_INVOICE_FOR_PAYMENT'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<=0 then raise exception 'INVALID_AMOUNT'; end if;
  p_amount:=round(p_amount,2);
  if p_amount>greatest(a.balance,0) then raise exception 'PAYMENT_EXCEEDS_OUTSTANDING'; end if;
  update public.credit_accounts set balance=balance-p_amount,updated_at=now() where id=a.id;
  insert into public.credit_transactions(credit_account_id,business_id,store_id,txn_type,amount,balance_after,note,performed_by)
    values(a.id,a.business_id,a.store_id,'PAYMENT',-p_amount,a.balance-p_amount,p_note,auth.uid()) returning id into tid;
  perform app.audit('credit.payment','credit_transactions',tid,a.business_id,a.store_id,null,jsonb_build_object('amount',p_amount));
  return tid;
end $$;
do $$ declare sig regprocedure; begin
  for sig in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('post_invoice_entry','issue_invoice_goods','cancel_sales_invoice','record_credit_payment') loop
    execute format('revoke execute on function %s from public,anon',sig); execute format('grant execute on function %s to authenticated',sig);
  end loop;
end $$;
