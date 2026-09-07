-- Action grants are separate from module visibility and scoped to assigned stores.
create table public.store_return_access (
 membership_id uuid not null, store_id uuid not null,
 approve boolean not null default false, refund boolean not null default false,
 version bigint not null default 1, updated_by uuid references auth.users(id),
 primary key(membership_id,store_id),
 foreign key(membership_id,store_id) references public.store_memberships(membership_id,store_id) on delete cascade
);
alter table public.store_return_access enable row level security;
create index store_return_access_store on public.store_return_access(store_id);
revoke all on public.store_return_access from public,anon,authenticated;
grant select on public.store_return_access to authenticated;
create policy return_access_read on public.store_return_access for select to authenticated using(
 app.has_business_role(app.store_business(store_id),'owner') or exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=auth.uid() and m.is_active));
create function app.can_return_action(p_store uuid,p_action text) returns boolean
language sql stable security definer set search_path=public,app as $$
 select app.has_module(p_store,'returns') and p_action in ('approve','refund') and
 (app.has_store_role(p_store,'manager') or exists(select 1 from public.store_return_access a join public.memberships m on m.id=a.membership_id
 where a.store_id=p_store and m.user_id=auth.uid() and m.is_active and case when p_action='approve' then a.approve else a.refund end));
$$;
revoke all on function app.can_return_action(uuid,text) from public,anon,authenticated;
create function public.my_return_access(p_store uuid) returns jsonb language plpgsql stable security definer set search_path=public,app as $$
begin
 perform app.require_module(p_store,array['returns']);
 return jsonb_build_object('approve',app.can_return_action(p_store,'approve'),'refund',app.can_return_action(p_store,'refund'));
end $$;
create function public.set_store_return_access(p_membership uuid,p_store uuid,p_approve boolean,p_refund boolean,p_expected bigint) returns bigint
language plpgsql security definer set search_path=public,app as $$
declare m public.memberships%rowtype; v bigint;
begin
 select * into m from public.memberships where id=p_membership for update;
 if not found or not app.has_business_role(m.business_id,'owner') or app.store_business(p_store) is distinct from m.business_id then raise exception 'FORBIDDEN'; end if;
 if not exists(select 1 from public.store_memberships where membership_id=m.id and store_id=p_store) then raise exception 'LOCATION_NOT_ASSIGNED'; end if;
 if p_approve is null or p_refund is null then raise exception 'INVALID_PERMISSIONS'; end if;
 select version into v from public.store_return_access where membership_id=m.id and store_id=p_store;
 if coalesce(v,0) is distinct from p_expected then raise exception 'ACCESS_CHANGED_REFRESH'; end if;
 v:=coalesce(v,0)+1;
 insert into public.store_return_access values(m.id,p_store,p_approve,p_refund,v,auth.uid())
 on conflict(membership_id,store_id) do update set approve=excluded.approve,refund=excluded.refund,version=excluded.version,updated_by=excluded.updated_by;
 perform app.audit('access.return_actions','membership',m.id,m.business_id,p_store,null,jsonb_build_object('approve',p_approve,'refund',p_refund));
 return v;
end $$;
-- Preserve the existing locking, retry and money controls; change only the action guard.
do $$ declare n text; definition text; action text; begin
 foreach n in array array['process_goods_return','record_customer_refund'] loop
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='app_private' and p.proname=n;
  if position('app.has_store_role(r.store_id,''manager'')' in definition)=0 then raise exception 'RETURN_GUARD_NOT_FOUND'; end if;
  action:=case when n='process_goods_return' then 'approve' else 'refund' end;
  execute replace(definition,'app.has_store_role(r.store_id,''manager'')',format('app.can_return_action(r.store_id,%L)',action));
 end loop;
end $$;
create function public.return_refund_summary(p_return uuid) returns jsonb language plpgsql stable security definer set search_path=public,app as $$
declare r public.goods_returns%rowtype; refunded numeric; available numeric; invoice_refunds numeric; balance numeric; ref text;
begin
 select * into r from public.goods_returns where id=p_return;
 perform app.require_module(r.store_id,array['returns']);
 select coalesce(sum(amount),0) into refunded from public.customer_refunds where return_id=r.id;
 available:=r.amount-refunded;
 if r.invoice_id is not null then
  select coalesce(sum(f.amount),0) into invoice_refunds from public.customer_refunds f join public.goods_returns gr on gr.id=f.return_id where gr.invoice_id=r.invoice_id;
  available:=least(available,(select greatest(-outstanding,0) from public.v_invoice_balances where id=r.invoice_id)-invoice_refunds);
  select payment_reference into ref from public.invoice_entries where invoice_id=r.invoice_id and kind='PAYMENT' and nullif(payment_reference,'') is not null order by created_at desc,id desc limit 1;
 else
  select payment_reference into ref from public.goods_out where id=r.sale_id;
 end if;
 if r.customer_id is not null then
  select a.balance into balance from public.credit_accounts a where customer_id=r.customer_id;
  available:=least(available,greatest(-balance,0));
 end if;
 return jsonb_build_object('approved',r.amount,'refunded',refunded,'available',case when r.status='APPROVED' then greatest(available,0) else 0 end,'reference',coalesce(ref,r.reference));
end $$;
revoke all on function public.my_return_access(uuid),public.set_store_return_access(uuid,uuid,boolean,boolean,bigint),public.return_refund_summary(uuid) from public,anon;
grant execute on function public.my_return_access(uuid),public.set_store_return_access(uuid,uuid,boolean,boolean,bigint),public.return_refund_summary(uuid) to authenticated;
