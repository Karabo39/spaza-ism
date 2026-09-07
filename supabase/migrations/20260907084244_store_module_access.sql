-- Module grants are scoped to an assigned membership/location, never JWT metadata.
create table public.module_catalog (
  key text primary key, label text not null, minimum_role app.membership_role not null
);
insert into public.module_catalog(key,label,minimum_role) values
('dashboard','Dashboard','employee'),
('operations','Transfers & unpacking','employee'),
('goods_in','Goods In','employee'),
('goods_out','Goods Out','employee'),
('orders','Orders','employee'),
('invoices','Invoices','employee'),
('returns','Goods Return','employee'),
('check_stock','Check Stock','employee'),
('check_price','Check Price','employee'),
('credit','Credit Customers','employee'),
('adjust','Adjust Stock','manager'),
('stock_take','Stock Take','employee'),
('low_stock','Low Stock','employee'),
('expiry','Expiry','employee'),
('products','Products','employee'),
('suppliers','Suppliers','employee'),
('imports','Excel imports','manager'),
('reports','Reports','employee'),
('users','Users','owner'),
('audit','Audit','manager'),
('settings','Settings','manager'),
('stores','My Stores','owner'),
('access_control','Access Control','owner'),
('cash_up','Cash-up','employee');
alter table public.module_catalog enable row level security;
revoke all on public.module_catalog from public,anon,authenticated;
grant select on public.module_catalog to authenticated;
create policy read_module_catalog on public.module_catalog for select to authenticated using(true);

create table public.store_module_access (
  membership_id uuid not null, store_id uuid not null,
  permissions jsonb not null default '{}'::jsonb check(jsonb_typeof(permissions)='object'),
  version bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(membership_id,store_id),
  foreign key(membership_id,store_id) references public.store_memberships(membership_id,store_id) on delete cascade
);
create index store_module_access_store on public.store_module_access(store_id,membership_id);
-- Retained assignments must keep their overrides when another location changes.
create or replace function public.set_member_locations(p_membership uuid,p_stores uuid[])
returns void language plpgsql security definer set search_path=public,app as $f$
declare m public.memberships%rowtype; previous jsonb;
begin
 select * into m from public.memberships where id=p_membership for update;
 if not found or not app.has_business_role(m.business_id,'owner') then raise exception 'FORBIDDEN'; end if;
 if m.role='owner' then raise exception 'OWNER_HAS_ALL_LOCATIONS'; end if;
 if p_stores is null then raise exception 'LOCATIONS_REQUIRED'; end if;
 if exists(select 1 from unnest(p_stores) x(id) left join public.stores s on s.id=x.id
   where s.id is null or s.business_id<>m.business_id or not s.is_active) then raise exception 'INVALID_LOCATION'; end if;
 select coalesce(jsonb_agg(store_id order by store_id),'[]'::jsonb) into previous from public.store_memberships where membership_id=m.id;
 delete from public.store_memberships where membership_id=m.id and not(store_id=any(p_stores));
 insert into public.store_memberships(membership_id,store_id,business_id,assigned_by)
 select m.id,id,m.business_id,auth.uid() from (select distinct unnest(p_stores) id) selected on conflict do nothing;
 perform app.audit('member.locations','membership',m.id,m.business_id,null,jsonb_build_object('locations',previous),jsonb_build_object('locations',to_jsonb(p_stores)));
end $f$;
alter table public.store_module_access enable row level security;
revoke all on public.store_module_access from public,anon,authenticated;
grant select on public.store_module_access to authenticated;
create policy read_module_access on public.store_module_access for select to authenticated using(
  app.has_business_role(app.store_business(store_id),'owner') or
  exists(select 1 from public.memberships m where m.id=membership_id and m.user_id=(select auth.uid()) and m.is_active)
);

create function app.member_has_module(p_user uuid,p_store uuid,p_module text) returns boolean
language sql stable security definer set search_path=public,app as $f$
 select exists(
  select 1 from public.memberships m join public.stores s on s.business_id=m.business_id
  join public.module_catalog c on c.key=p_module
  left join public.store_module_access a on a.membership_id=m.id and a.store_id=s.id
  where s.id=p_store and s.is_active and m.user_id=p_user and m.is_active
    and app.role_rank(m.role)>=app.role_rank(c.minimum_role)
    and (m.role='owner' or (exists(select 1 from public.store_memberships sm where sm.membership_id=m.id and sm.store_id=s.id)
      and coalesce((a.permissions->>p_module)::boolean,true)))
 );
$f$;
revoke all on function app.member_has_module(uuid,uuid,text) from public,anon,authenticated;
create function app.has_module(p_store uuid,p_module text) returns boolean
language sql stable security definer set search_path=public,app as $f$
 select app.member_has_module(auth.uid(),p_store,p_module);
$f$;
-- Credit approval codes and outstanding tokens also respect revoked modules.
create or replace function app.member_manages_location(p_user uuid,p_store uuid) returns boolean
language sql stable security definer set search_path=public,app as $f$
 select exists(select 1 from public.memberships where user_id=p_user and business_id=app.store_business(p_store) and is_active and role in ('manager','owner'))
  and (app.member_has_module(p_user,p_store,'goods_out') or app.member_has_module(p_user,p_store,'invoices'));
$f$;
create function app.has_any_module(p_store uuid,p_modules text[]) returns boolean
language sql stable security definer set search_path=public,app as $f$
 select exists(select 1 from unnest(p_modules) k where app.has_module(p_store,k));
$f$;
create function app.has_business_module(p_business uuid,p_modules text[]) returns boolean
language sql stable security definer set search_path=public,app as $f$
 select exists(select 1 from public.stores where business_id=p_business and app.has_any_module(id,p_modules));
$f$;
create function app.require_module(p_store uuid,p_modules text[]) returns void
language plpgsql stable security definer set search_path=public,app as $f$
begin
 if not app.has_any_module(p_store,p_modules) then raise exception 'FORBIDDEN'; end if;
end $f$;

create function public.my_module_access(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path=public,app as $f$
begin
 if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
 return (select jsonb_object_agg(key,app.has_module(p_store,key)) from public.module_catalog);
end $f$;

create function public.set_store_module_access(p_membership uuid,p_store uuid,p_permissions jsonb,p_expected bigint)
returns bigint language plpgsql security definer set search_path=public,app as $f$
declare m public.memberships%rowtype; previous jsonb; current_version bigint; new_version bigint;
begin
 select * into m from public.memberships where id=p_membership for update;
 if not found or not app.has_business_role(m.business_id,'owner') or app.store_business(p_store)<>m.business_id then raise exception 'FORBIDDEN'; end if;
 if m.role='owner' then raise exception 'OWNER_ACCESS_FIXED'; end if;
 if not exists(select 1 from public.store_memberships where membership_id=m.id and store_id=p_store) then raise exception 'LOCATION_NOT_ASSIGNED'; end if;
 if p_permissions is null or jsonb_typeof(p_permissions)<>'object' then raise exception 'INVALID_PERMISSIONS'; end if;
 if exists(select 1 from jsonb_each(p_permissions) e left join public.module_catalog c on c.key=e.key
   where c.key is null or jsonb_typeof(e.value)<>'boolean'
     or (e.value='true'::jsonb and app.role_rank(m.role)<app.role_rank(c.minimum_role))) then raise exception 'INVALID_PERMISSIONS'; end if;
 select permissions,version into previous,current_version from public.store_module_access where membership_id=m.id and store_id=p_store;
 current_version:=coalesce(current_version,0);
 if p_expected is distinct from current_version then raise exception 'ACCESS_CHANGED_REFRESH'; end if;
 new_version:=current_version+1;
 insert into public.store_module_access(membership_id,store_id,permissions,version,updated_by)
 values(m.id,p_store,p_permissions,new_version,auth.uid())
 on conflict(membership_id,store_id) do update set permissions=excluded.permissions,version=excluded.version,updated_by=excluded.updated_by,updated_at=now();
 perform app.audit('access.modules','membership',m.id,m.business_id,p_store,coalesce(previous,'{}'::jsonb),p_permissions);
 return new_version;
end $f$;
revoke all on function public.my_module_access(uuid),public.set_store_module_access(uuid,uuid,jsonb,bigint) from public,anon;
grant execute on function public.my_module_access(uuid),public.set_store_module_access(uuid,uuid,jsonb,bigint) to authenticated;
revoke all on function app.require_module(uuid,text[]) from public,anon,authenticated;
revoke all on function app.has_module(uuid,text),app.has_any_module(uuid,text[]),app.has_business_module(uuid,text[]) from public,anon;
grant execute on function app.has_module(uuid,text),app.has_any_module(uuid,text[]),app.has_business_module(uuid,text[]) to authenticated;

-- Keep the tested implementations private and expose guarded functions with
-- the same signatures. Direct calls to the private implementations are denied.
create schema app_private;
revoke all on schema app_private from public,anon,authenticated;
do $wrap$
declare rule record; fn record; call_args text; body text; ret text;
begin
 for rule in select * from (values
('adjust_stock','perform app.require_module(p_store,array[''adjust'']);'),
('allocate_return_credit','perform app.require_module((select store_id from public.goods_returns where id=p_return),array[''returns'']);perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices'']);'),
('authorize_credit_override','perform app.require_module(p_store,array[''goods_out'',''invoices'']);'),
('cancel_sales_invoice','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices'']);'),
('cancel_stock_take','perform app.require_module((select store_id from public.stock_takes where id=p_stock_take),array[''stock_take'']);'),
('complete_report_email','perform app.require_module((select store_id from public.report_email_jobs where id=p_job),array[''reports'']);'),
('complete_sale','perform app.require_module(p_store,array[''goods_out'']);'),
('complete_stock_take','perform app.require_module((select store_id from public.stock_takes where id=p_stock_take),array[''stock_take'']);'),
('create_product','perform app.require_module(p_store,array[''products'',''goods_in'',''goods_out'']);'),
('create_sales_invoice','perform app.require_module((select store_id from public.sales_orders where id=p_order),array[''invoices'']);'),
('create_sales_order','perform app.require_module(p_store,array[''orders'']);'),
('create_stock_transfer','perform app.require_module(p_source,array[''operations'']);perform app.require_module(p_destination,array[''operations'']);'),
('credit_override_authorizers','perform app.require_module(p_store,array[''goods_out'',''invoices'']);'),
('customer_statement','perform app.require_module((select store_id from public.customers where id=p_customer),array[''credit'']);'),
('dashboard_summary','perform app.require_module(p_store,array[''dashboard'']);'),
('import_excel','perform app.require_module(p_store,array[''imports'']);'),
('invoice_monthly_reconciliation','perform app.require_module(p_store,array[''reports'']);'),
('invoice_summary','perform app.require_module(p_store,array[''invoices'',''dashboard'']);'),
('issue_invoice_goods','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices'']);'),
('issue_sales_invoice','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices'']);'),
('post_invoice_entry','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices'']);'),
('prepare_report_email','perform app.require_module(p_store,array[''reports'']);'),
('process_goods_return','perform app.require_module((select store_id from public.goods_returns where id=p_return),array[''returns'']);'),
('process_sales_order','perform app.require_module((select store_id from public.sales_orders where id=p_order),array[''orders'']);'),
('process_stock_transfer','perform app.require_module((select source_id from public.stock_transfers where id=p_transfer),array[''operations'']);perform app.require_module((select destination_id from public.stock_transfers where id=p_transfer),array[''operations'']);'),
('product_sales_summary','perform app.require_module(p_store,array[''reports'']);'),
('profit_summary','perform app.require_module(p_store,array[''reports'']);'),
('receive_stock','perform app.require_module(p_store,array[''goods_in'']);'),
('reconcile_stock','perform app.require_module(p_store,array[''reports'',''adjust'',''stock_take'']);'),
('record_credit_payment','perform app.require_module((select store_id from public.customers where id=p_customer),array[''credit'']);'),
('record_customer_refund','perform app.require_module((select store_id from public.goods_returns where id=p_return),array[''returns'']);'),
('resolve_return_quarantine','perform app.require_module((select r.store_id from public.goods_return_items i join public.goods_returns r on r.id=i.return_id where i.id=p_item),array[''returns'']);'),
('save_stock_take_count','perform app.require_module((select s.store_id from public.stock_take_items i join public.stock_takes s on s.id=i.stock_take_id where i.id=p_item),array[''stock_take'']);'),
('set_bulk_conversion','perform app.require_module((select store_id from public.products where id=p_pack),array[''operations'']);'),
('set_credit_limit','perform app.require_module((select store_id from public.customers where id=p_customer),array[''credit'']);'),
('set_credit_override_code','if not app.has_business_module(p_business,array[''settings'']) then raise exception ''FORBIDDEN''; end if;'),
('set_notification_preference','perform app.require_module(p_store,array[''settings'']);'),
('start_stock_take','perform app.require_module(p_store,array[''stock_take'']);'),
('submit_goods_return','perform app.require_module((case when p_source_type=''invoice'' then (select store_id from public.sales_invoices where id=p_source) else (select store_id from public.goods_out where id=p_source) end),array[''returns'']);'),
('transfer_history','if not app.has_business_module(p_business,array[''operations'',''reports'']) then raise exception ''FORBIDDEN''; end if;'),
('unpack_stock','perform app.require_module((select store_id from public.bulk_conversions where id=p_conversion),array[''operations'']);'),
('unpack_stock_with_count','perform app.require_module((select store_id from public.bulk_conversions where id=p_conversion),array[''operations'']);'),
('update_location','perform app.require_module(p_store,array[''settings'',''stores'']);')
 ) as guard_rules(name,guard) loop
   select p.*,pg_get_function_arguments(p.oid) as args,
     pg_get_function_identity_arguments(p.oid) as identity_args,
     pg_get_function_result(p.oid) as result_type into strict fn
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=rule.name;
   select string_agg(format('%I',fn.proargnames[i]),',' order by i) into call_args from generate_series(1,fn.pronargs) i;
   execute format('alter function public.%I(%s) set schema app_private',rule.name,fn.identity_args);
   execute format('revoke all on function app_private.%I(%s) from public,anon,authenticated',rule.name,fn.identity_args);
   if fn.proretset then
     ret:=format('return query select * from app_private.%I(%s)',rule.name,call_args);
     if rule.name='transfer_history' then
       ret:=ret||' t where app.has_any_module(t.source_id,array[''operations'',''reports'']) and app.has_any_module(t.destination_id,array[''operations'',''reports''])';
     end if;
     ret:=ret||';';
   elsif fn.result_type='void' then ret:=format('perform app_private.%I(%s); return;',rule.name,call_args);
   else ret:=format('return app_private.%I(%s);',rule.name,call_args);
   end if;
   body:='begin '||rule.guard||' '||ret||' end;';
   execute format('create function public.%I(%s) returns %s language plpgsql security definer set search_path=public,app as %L',
     rule.name,fn.args,fn.result_type,body);
   execute format('revoke all on function public.%I(%s) from public,anon',rule.name,fn.identity_args);
   execute format('grant execute on function public.%I(%s) to authenticated',rule.name,fn.identity_args);
 end loop;
end $wrap$;

-- Restrictive policies compose with existing tenant/location rules. Shared
-- lookup data remains readable by modules that need it to complete their work.

create policy module_read on public.products as restrictive for select to authenticated using(app.has_any_module(store_id,array['dashboard','operations','goods_in','goods_out','orders','invoices','returns','check_stock','check_price','credit','adjust','stock_take','low_stock','expiry','products','imports','reports']));
create policy module_read on public.product_barcodes as restrictive for select to authenticated using(app.has_any_module(store_id,array['dashboard','operations','goods_in','goods_out','orders','invoices','returns','check_stock','check_price','credit','adjust','stock_take','low_stock','expiry','products','imports','reports']));
create policy module_read on public.stock as restrictive for select to authenticated using(app.has_any_module(store_id,array['dashboard','operations','goods_in','goods_out','orders','invoices','returns','check_stock','check_price','credit','adjust','stock_take','low_stock','expiry','products','imports','reports']));
create policy module_read on public.stock_batches as restrictive for select to authenticated using(app.has_any_module(store_id,array['dashboard','operations','goods_in','goods_out','orders','invoices','returns','check_stock','check_price','credit','adjust','stock_take','low_stock','expiry','products','imports','reports']));
create policy module_read on public.goods_in as restrictive for select to authenticated using(app.has_any_module(store_id,array['goods_in','suppliers','reports']));
create policy module_read on public.supplier_invoices as restrictive for select to authenticated using(app.has_any_module(store_id,array['goods_in','suppliers','reports']));
create policy module_read on public.goods_out as restrictive for select to authenticated using(app.has_any_module(store_id,array['goods_out','returns','reports']));
create policy module_read on public.customers as restrictive for select to authenticated using(app.has_any_module(store_id,array['credit','goods_out','orders','invoices','returns','imports','reports','dashboard']));
create policy module_read on public.credit_accounts as restrictive for select to authenticated using(app.has_any_module(store_id,array['credit','goods_out','orders','invoices','returns','imports','reports','dashboard']));
create policy module_read on public.credit_transactions as restrictive for select to authenticated using(app.has_any_module(store_id,array['credit','invoices','returns','reports','cash_up']));
create policy module_read on public.stock_movements as restrictive for select to authenticated using(app.has_any_module(store_id,array['dashboard','check_stock','products','adjust','stock_take','operations','reports']));
create policy module_read on public.stock_adjustments as restrictive for select to authenticated using(app.has_any_module(store_id,array['adjust','reports','stock_take']));
create policy module_read on public.stock_adjustment_requests as restrictive for select to authenticated using(app.has_any_module(store_id,array['adjust','reports','stock_take']));
create policy module_read on public.stock_takes as restrictive for select to authenticated using(app.has_any_module(store_id,array['stock_take','reports']));
create policy module_read on public.sales_orders as restrictive for select to authenticated using(app.has_any_module(store_id,array['orders','invoices']));
create policy module_read on public.sales_invoices as restrictive for select to authenticated using(app.has_any_module(store_id,array['invoices','returns','reports','credit']));
create policy module_read on public.invoice_entries as restrictive for select to authenticated using(app.has_any_module(store_id,array['invoices','returns','reports','credit']));
create policy module_read on public.goods_returns as restrictive for select to authenticated using(app.has_any_module(store_id,array['returns','invoices','reports']));
create policy module_read on public.customer_refunds as restrictive for select to authenticated using(app.has_any_module(store_id,array['returns','invoices','reports']));
create policy module_read on public.store_credit_allocations as restrictive for select to authenticated using(app.has_any_module(store_id,array['returns','invoices','reports']));
create policy module_read on public.bulk_conversions as restrictive for select to authenticated using(app.has_any_module(store_id,array['operations','reports']));
create policy module_read on public.bulk_unpackings as restrictive for select to authenticated using(app.has_any_module(store_id,array['operations','reports']));
create policy module_read on public.bulk_count_overrides as restrictive for select to authenticated using(app.has_any_module(store_id,array['operations','reports']));
create policy module_read on public.price_history as restrictive for select to authenticated using(app.has_any_module(store_id,array['products','reports']));
create policy module_read on public.product_price_history as restrictive for select to authenticated using(app.has_any_module(store_id,array['products','reports']));
create policy module_read on public.import_batches as restrictive for select to authenticated using(app.has_any_module(store_id,array['imports']));
create policy module_read on public.report_email_jobs as restrictive for select to authenticated using(app.has_any_module(store_id,array['reports']));
create policy module_read on public.notification_preferences as restrictive for select to authenticated using(app.has_any_module(store_id,array['settings']));
create policy module_read on public.audit_logs as restrictive for select to authenticated using(app.has_any_module(store_id,array['audit']) or (store_id is null and app.has_business_role(business_id,'owner')));
create policy module_read on public.goods_in_items as restrictive for select to authenticated using(app.has_any_module((select store_id from public.goods_in where id=goods_in_id),array['goods_in','suppliers','reports']));
create policy module_read on public.goods_out_items as restrictive for select to authenticated using(app.has_any_module((select store_id from public.goods_out where id=goods_out_id),array['goods_out','returns','reports']));
create policy module_read on public.stock_take_items as restrictive for select to authenticated using(app.has_any_module((select store_id from public.stock_takes where id=stock_take_id),array['stock_take','reports']));
create policy module_read on public.sales_order_items as restrictive for select to authenticated using(app.has_any_module((select store_id from public.sales_orders where id=order_id),array['orders','invoices']));
create policy module_read on public.sales_invoice_items as restrictive for select to authenticated using(app.has_any_module((select store_id from public.sales_invoices where id=invoice_id),array['invoices','returns','reports']));
create policy module_read on public.goods_return_items as restrictive for select to authenticated using(app.has_any_module((select store_id from public.goods_returns where id=return_id),array['returns','invoices','reports']));
create policy module_read on public.return_dispositions as restrictive for select to authenticated using(app.has_any_module((select r.store_id from public.goods_return_items i join public.goods_returns r on r.id=i.return_id where i.id=return_item_id),array['returns','reports']));
create policy module_read on public.notification_deliveries as restrictive for select to authenticated using(app.has_any_module((select store_id from public.notification_preferences where id=preference_id),array['settings']));
create policy module_insert on public.products as restrictive for insert to authenticated with check(app.has_any_module(store_id,array['products']));
create policy module_update on public.products as restrictive for update to authenticated using(app.has_any_module(store_id,array['products'])) with check(app.has_any_module(store_id,array['products']));
create policy module_insert on public.product_barcodes as restrictive for insert to authenticated with check(app.has_any_module(store_id,array['products']));
create policy module_update on public.product_barcodes as restrictive for update to authenticated using(app.has_any_module(store_id,array['products'])) with check(app.has_any_module(store_id,array['products']));
create policy module_insert on public.customers as restrictive for insert to authenticated with check(app.has_any_module(store_id,array['credit','goods_out','orders','invoices']));
create policy module_update on public.customers as restrictive for update to authenticated using(app.has_any_module(store_id,array['credit','goods_out','orders','invoices'])) with check(app.has_any_module(store_id,array['credit','goods_out','orders','invoices']));
create policy module_insert on public.suppliers as restrictive for insert to authenticated with check(app.has_business_module(business_id,array['suppliers']));
create policy module_update on public.suppliers as restrictive for update to authenticated using(app.has_business_module(business_id,array['suppliers'])) with check(app.has_business_module(business_id,array['suppliers']));
create policy module_insert on public.categories as restrictive for insert to authenticated with check(app.has_business_module(business_id,array['products']));
create policy module_update on public.categories as restrictive for update to authenticated using(app.has_business_module(business_id,array['products'])) with check(app.has_business_module(business_id,array['products']));
create policy module_read on public.stock_transfers as restrictive for select to authenticated using(
 app.has_any_module(source_id,array['operations','reports']) and app.has_any_module(destination_id,array['operations','reports']));
create policy module_read on public.stock_transfer_items as restrictive for select to authenticated using(
 exists(select 1 from public.stock_transfers t where t.id=transfer_id));
create policy module_read on public.suppliers as restrictive for select to authenticated using(
 app.has_business_module(business_id,array['suppliers','products','goods_in','imports','reports']));
create policy module_read on public.categories as restrictive for select to authenticated using(
 app.has_business_module(business_id,array['products','goods_in','goods_out','check_stock','check_price','imports','reports']));
create policy module_insert on public.supplier_invoices as restrictive for insert to authenticated with check(app.has_module(store_id,'goods_in'));
create policy module_update on public.businesses as restrictive for update to authenticated
 using(app.has_business_role(id,'owner')) with check(app.has_business_role(id,'owner'));
