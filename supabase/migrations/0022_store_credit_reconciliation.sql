alter table public.invoice_entries drop constraint invoice_entries_method_check;
alter table public.invoice_entries add constraint invoice_entries_method_check check(method in ('CASH','CARD_EFT','CREDIT'));
create table public.store_credit_allocations (
  id uuid primary key default gen_random_uuid(), return_id uuid not null references public.goods_returns(id),
  invoice_id uuid not null references public.sales_invoices(id), business_id uuid not null references public.businesses(id),
  store_id uuid not null references public.stores(id), amount numeric(14,2) not null check(amount>0 and amount::text<>'NaN'),
  payment_entry_id uuid not null references public.invoice_entries(id), performed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), request_id uuid not null, request_payload jsonb not null, unique(business_id,request_id)
);
create index store_credit_allocations_return on public.store_credit_allocations(return_id);
alter table public.store_credit_allocations enable row level security;
revoke all on public.store_credit_allocations from public,anon,authenticated;
grant select on public.store_credit_allocations to authenticated;
create policy credit_allocations_read on public.store_credit_allocations for select to authenticated using(app.has_store_access(store_id));
create trigger credit_allocations_append_only before update or delete on public.store_credit_allocations for each row execute function app.block_mutation();

create function app.guard_refund_after_allocation()
returns trigger language plpgsql security definer set search_path=public,app as $$
declare r public.goods_returns%rowtype; used numeric;
begin
  select * into r from public.goods_returns where id=new.return_id for update;
  select coalesce((select sum(amount) from public.customer_refunds where return_id=r.id),0)+coalesce((select sum(amount) from public.store_credit_allocations where return_id=r.id),0) into used;
  if new.amount>r.amount-used then raise exception 'REFUND_EXCEEDS_AVAILABLE_CREDIT'; end if;
  return new;
end $$;
create trigger refund_allocation_cap before insert on public.customer_refunds for each row execute function app.guard_refund_after_allocation();

create function public.allocate_return_credit(p_return uuid,p_invoice uuid,p_amount numeric,p_request uuid)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare r public.goods_returns%rowtype; i public.sales_invoices%rowtype; old public.store_credit_allocations%rowtype; payload jsonb; available numeric; outstanding numeric; eid uuid; source_entry uuid; aid uuid:=gen_random_uuid();
begin
  select * into r from public.goods_returns where id=p_return;
  select * into i from public.sales_invoices where id=p_invoice;
  if r.id is null or i.id is null or not app.has_store_access(i.store_id) or r.store_id<>i.store_id or (r.customer_id is not null and r.customer_id<>i.customer_id) then raise exception 'FORBIDDEN'; end if;
  if r.invoice_id=i.id then raise exception 'CREDIT_SOURCE_EQUALS_TARGET'; end if;
  -- Keep the same original-document -> return -> customer lock ordering as refunds.
  perform id from public.sales_invoices where id in (i.id,r.invoice_id) order by id for update;
  if r.sale_id is not null then perform 1 from public.goods_out where id=r.sale_id for update; end if;
  select * into r from public.goods_returns where id=p_return for update;
  select * into i from public.sales_invoices where id=p_invoice;
  if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
  payload:=jsonb_build_object('user',auth.uid(),'return',r.id,'invoice',i.id,'amount',p_amount);
  perform pg_advisory_xact_lock(hashtextextended(i.business_id::text||p_request::text,0));
  select * into old from public.store_credit_allocations where business_id=i.business_id and request_id=p_request;
  if found then if old.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return old.id; end if;
  if r.status<>'APPROVED' or i.state<>'ISSUED' then raise exception 'INVALID_INVOICE_STATE'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<=0 then raise exception 'INVALID_AMOUNT'; end if;
  p_amount:=round(p_amount,2);
  select r.amount-coalesce((select sum(amount) from public.customer_refunds where return_id=r.id),0)-coalesce((select sum(amount) from public.store_credit_allocations where return_id=r.id),0) into available;
  if r.invoice_id is not null then
    -- Refunded credit is already spent even though the source invoice remains credited.
    available:=least(available,(select greatest(-b.outstanding,0) from public.v_invoice_balances b where id=r.invoice_id)-coalesce((select sum(f.amount) from public.customer_refunds f join public.goods_returns gr on gr.id=f.return_id where gr.invoice_id=r.invoice_id),0));
  end if;
  select b.outstanding into outstanding from public.v_invoice_balances b where id=i.id;
  if p_amount>available or p_amount>outstanding then raise exception 'CREDIT_EXCEEDS_AVAILABLE'; end if;
  if r.invoice_id is not null then
    insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,reason,performed_by,request_id,request_payload)
      values(r.invoice_id,r.business_id,r.store_id,'DEBIT_NOTE',p_amount,'Store credit allocated to '||i.reference,auth.uid(),gen_random_uuid(),jsonb_build_object('allocation',aid)) returning id into source_entry;
  end if;
  if r.customer_id is not null then perform app.post_customer_entry(r.customer_id,p_amount,'ADJUSTMENT',case when source_entry is null then 'store_credit_allocations' else 'invoice_entries' end,coalesce(source_entry,aid),'Store credit allocated to '||i.reference); end if;
  insert into public.invoice_entries(invoice_id,business_id,store_id,kind,amount,method,reason,performed_by,request_id,request_payload)
    values(i.id,i.business_id,i.store_id,'PAYMENT',p_amount,'CREDIT','Store credit from '||r.reference,auth.uid(),gen_random_uuid(),jsonb_build_object('allocation',aid)) returning id into eid;
  perform app.post_customer_entry(i.customer_id,-p_amount,'PAYMENT','invoice_entries',eid,'Store credit received on '||i.reference);
  insert into public.store_credit_allocations(id,return_id,invoice_id,business_id,store_id,amount,payment_entry_id,performed_by,request_id,request_payload)
    values(aid,r.id,i.id,i.business_id,i.store_id,p_amount,eid,auth.uid(),p_request,payload);
  perform app.audit('invoice.store_credit','store_credit_allocations',aid,i.business_id,i.store_id,null,payload);
  return aid;
end $$;

create function public.invoice_summary(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path=public,app as $$
declare result jsonb;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('invoiced',coalesce(sum(total) filter(where state='ISSUED'),0),'paid',coalesce(sum(paid) filter(where state='ISSUED'),0),
    'outstanding',coalesce(sum(greatest(outstanding,0)),0),'overdue',coalesce(sum(greatest(outstanding,0)) filter(where status='OVERDUE'),0),
    'credit_notes',coalesce(sum(credits),0),'month_to_date',coalesce(sum(total) filter(where state='ISSUED' and issued_at>=date_trunc('month',now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'),0)) into result
    from public.v_invoice_balances where store_id=p_store;
  return result;
end $$;

create function public.invoice_monthly_reconciliation(p_store uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,app as $$
declare start_at timestamptz; end_at timestamptz; result jsonb; opening numeric; closing numeric;
begin
  if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN'; end if;
  if p_month is null then raise exception 'MONTH_REQUIRED'; end if;
  start_at:=date_trunc('month',p_month::timestamp) at time zone 'Africa/Johannesburg'; end_at:=(date_trunc('month',p_month::timestamp)+interval '1 month') at time zone 'Africa/Johannesburg';
  select coalesce(sum(case when kind in ('ISSUE','DEBIT_NOTE') then amount else -amount end),0) into opening from public.invoice_entries where store_id=p_store and created_at<start_at;
  select coalesce(sum(case when kind in ('ISSUE','DEBIT_NOTE') then amount else -amount end),0) into closing from public.invoice_entries where store_id=p_store and created_at<end_at;
  select jsonb_build_object('opening',opening,'invoiced',coalesce(sum(amount) filter(where kind='ISSUE'),0),'debits',coalesce(sum(amount) filter(where kind='DEBIT_NOTE'),0),
    'credit_notes',coalesce(sum(amount) filter(where kind='CREDIT_NOTE'),0),'voided',coalesce(sum(amount) filter(where kind='VOID'),0),
    'cash_received',coalesce(sum(amount) filter(where kind='PAYMENT' and method='CASH'),0),'card_received',coalesce(sum(amount) filter(where kind='PAYMENT' and method='CARD_EFT'),0),
    'store_credit_received',coalesce(sum(amount) filter(where kind='PAYMENT' and method='CREDIT'),0),'closing',closing,
    'refunds',coalesce((select sum(amount) from public.customer_refunds where store_id=p_store and created_at>=start_at and created_at<end_at),0),
    'customer_ledger_balance',coalesce((select sum(amount) from public.credit_transactions where store_id=p_store and created_at<end_at),0)) into result
    from public.invoice_entries where store_id=p_store and created_at>=start_at and created_at<end_at;
  return result;
end $$;

create view public.v_payment_activity with(security_invoker=true) as
  select g.id,g.store_id,g.business_id,g.created_at,g.sale_type::text method,g.total_amount amount,g.id::text reference,g.payment_reference,'CHECKOUT'::text source,g.id document_id from public.goods_out g
  union all select e.id,e.store_id,e.business_id,e.created_at,e.method,e.amount,e.reference,e.payment_reference,'INVOICE_PAYMENT',e.invoice_id from public.invoice_entries e where e.kind='PAYMENT'
  union all select i.id,i.store_id,i.business_id,i.issued_at,'CREDIT',i.total,i.reference,null,'INVOICE_CREDIT',i.id from public.sales_invoices i where i.state='ISSUED' and i.terms='CREDIT'
  union all select f.id,f.store_id,f.business_id,f.created_at,f.method,-f.amount,f.reference,f.payment_reference,'REFUND',f.return_id from public.customer_refunds f;
grant select on public.v_payment_activity to authenticated;

do $$ declare sig regprocedure; begin
  for sig in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('allocate_return_credit','invoice_summary','invoice_monthly_reconciliation') loop
    execute format('revoke execute on function %s from public,anon',sig); execute format('grant execute on function %s to authenticated',sig);
  end loop;
end $$;
