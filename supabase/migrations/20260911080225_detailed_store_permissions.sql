alter table public.module_catalog add column parent_key text references public.module_catalog(key), add column requires text[] not null default '{}';
insert into public.module_catalog(key,label,minimum_role,parent_key,requires) values
('dashboard_goods_in','Goods In','employee','dashboard',array['goods_in']::text[]),
('dashboard_goods_out','Goods Out','employee','dashboard',array['goods_out']::text[]),
('dashboard_check_stock','Check Stock','employee','dashboard',array['check_stock']::text[]),
('dashboard_check_price','Check Price','employee','dashboard',array['check_price']::text[]),
('dashboard_adjust','Adjust Stock','manager','dashboard',array['adjust']::text[]),
('dashboard_credit','Credit','employee','dashboard',array['credit']::text[]),
('dashboard_locations','All Business Locations','owner','dashboard',array['stores']::text[]),
('dashboard_invoicing','Invoicing','employee','dashboard',array['invoices_summary']::text[]),
('dashboard_movements','Recent Stock Movements','employee','dashboard',array[]::text[]),
('orders_new','New Order','employee','orders',array[]::text[]),
('orders_recent','Recent Orders','employee','orders',array[]::text[]),
('invoices_create_quotes','Create Quotes','employee','invoices',array[]::text[]),
('invoices_view_quotes','View All Quotes','employee','invoices',array[]::text[]),
('invoices_create_from_order','Create from Order','employee','invoices',array['orders_recent']::text[]),
('invoices_view_invoices','View Invoices','employee','invoices',array[]::text[]),
('invoices_summary','Invoicing','employee','invoices',array[]::text[]),
('invoices_invoiced','Invoiced','employee','invoices_summary',array[]::text[]),
('invoices_paid','Paid / Allocated','employee','invoices_summary',array[]::text[]),
('invoices_outstanding','Outstanding','employee','invoices_summary',array[]::text[]),
('invoices_overdue','Overdue','employee','invoices_summary',array[]::text[]),
('invoices_credit_notes','Credit Notes','employee','invoices_summary',array[]::text[]),
('invoices_month_to_date','Invoiced This Month','employee','invoices_summary',array[]::text[]);

-- Existing saved grants inherit enabled children; explicit false remains denied.
-- Owners retain recovery access. Definitions and dependencies are not user-editable.
create or replace function app.member_has_module(p_user uuid,p_store uuid,p_module text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare granted boolean; parent text; dependency text; dependencies text[];
begin
 select exists(
  select 1 from public.memberships m join public.stores s on s.business_id=m.business_id
  join public.module_catalog c on c.key=p_module
  left join public.store_module_access a on a.membership_id=m.id and a.store_id=s.id
  where s.id=p_store and s.is_active and m.user_id=p_user and m.is_active
   and app.role_rank(m.role)>=app.role_rank(c.minimum_role)
   and (m.role='owner' or (exists(select 1 from public.store_memberships sm where sm.membership_id=m.id and sm.store_id=s.id)
    and (not coalesce(a.permissions ? p_module,false) or a.permissions->p_module='true'::jsonb)))) into granted;
 if not granted then return false;end if;
 select parent_key,requires into parent,dependencies from public.module_catalog where key=p_module;
 if parent is not null and not app.member_has_module(p_user,p_store,parent) then return false;end if;
 foreach dependency in array dependencies loop
  if not app.member_has_module(p_user,p_store,dependency) then return false;end if;
 end loop;
 return true;
end $$;

-- Extend public entry points before any idempotent replay or data lookup.
do $$ declare rule record; fn record; source text; begin
 for rule in select * from (values
 ('create_sales_order','perform app.require_module(p_store,array[''orders_new'']);'),
 ('create_order_with_contact','perform app.require_module(p_store,array[''orders_new'']);'),
 ('process_sales_order','perform app.require_module((select store_id from public.sales_orders where id=p_order),array[''orders_recent'']);'),
 ('order_workflow_summary','perform app.require_module(p_store,array[''orders_recent'']);'),
 ('create_sales_invoice','perform app.require_module((select store_id from public.sales_orders where id=p_order),array[''invoices_create_from_order'']);'),
 ('save_quote','perform app.require_module(p_store,array[''invoices_create_quotes'']); if p_quote is not null then perform app.require_module(p_store,array[''invoices_view_quotes'']);end if;'),
 ('set_quote_status','perform app.require_module((select store_id from public.sales_quotes where id=p_quote),array[''invoices_view_quotes'']);'),
 ('convert_quote','perform app.require_module((select store_id from public.sales_quotes where id=p_quote),array[''invoices_view_quotes'']);perform app.require_module((select store_id from public.sales_quotes where id=p_quote),array[''orders_new'']);'),
 ('cancel_sales_invoice','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices_view_invoices'']);'),
 ('issue_sales_invoice','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices_view_invoices'']);'),
 ('issue_invoice_goods','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices_view_invoices'']);'),
 ('post_invoice_entry','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices_view_invoices'']);'),
 ('use_invoice_customer_credit','perform app.require_module((select store_id from public.sales_invoices where id=p_invoice),array[''invoices_view_invoices'']);'),
 ('prepare_document_email','if p_type=''invoice'' then perform app.require_module((select store_id from public.sales_invoices where id=p_document),array[''invoices_view_invoices'']);end if;')
 ) guards(name,guard) loop
  select p.oid into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=rule.name;
  source:=pg_get_functiondef(fn.oid);
  if source !~* '\mbegin\M' then raise exception 'Expected procedural entry point %',rule.name;end if;
  execute regexp_replace(source,'\mbegin\M','begin '||rule.guard,'i');
 end loop;
end $$;

-- A saved summary card is a server-side projection: unchecked totals are absent.
create or replace function public.invoice_summary(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; filtered jsonb:='{}'; k text;
begin
 perform app.require_module(p_store,array['invoices_summary']);
 result:=app_private.invoice_summary(p_store);
 foreach k in array array['invoiced','paid','outstanding','overdue','credit_notes','month_to_date'] loop
  if app.has_module(p_store,'invoices_'||k) then filtered:=filtered||jsonb_build_object(k,result->k);end if;
 end loop;
 return filtered;
end $$;

-- Direct table/view reads obey detail access. Other explicitly granted modules
-- (reports, returns, credit) keep their own legitimate document access.
do $$ declare rule record; pol record; expression text; begin
 for rule in select * from (values
 ('sales_orders','orders','orders_recent','invoices','invoices_create_from_order'),
 ('sales_order_items','orders','orders_recent','invoices','invoices_create_from_order'),
 ('sales_invoices','invoices','invoices_view_invoices',null,null),
 ('sales_invoice_items','invoices','invoices_view_invoices',null,null),
 ('invoice_entries','invoices','invoices_view_invoices',null,null),
 ('stock_movements','dashboard','dashboard_movements',null,null)
 ) rules(tab,old_key,new_key,old_key2,new_key2) loop
  select * into strict pol from pg_policies where schemaname='public' and tablename=rule.tab and policyname='module_read';
  expression:=replace(pol.qual,quote_literal(rule.old_key),quote_literal(rule.new_key));
  if rule.old_key2 is not null then expression:=replace(expression,quote_literal(rule.old_key2),quote_literal(rule.new_key2));end if;
  execute format('alter policy module_read on public.%I using (%s)',rule.tab,expression);
 end loop;
end $$;
alter policy quotes_read on public.sales_quotes using(app.has_module(store_id,'invoices_view_quotes'));

-- Purchase orders follow the permissions of the attached quote or order.
do $$ declare fn record; source text; begin
 for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_purchase_order','download_purchase_order') loop
  source:=pg_get_functiondef(fn.oid);
  if fn.proname='save_purchase_order' then
   source:=replace(source,'perform app.require_module(loc,array[''invoices'',''orders'']);','perform app.require_module(loc,case when p_quote is not null then array[''invoices_view_quotes''] else array[''orders_recent''] end);');
  else
   source:=replace(source,'perform app.require_module(doc.store_id,array[''invoices'',''orders'']);','if not ((doc.quote_id is not null and app.has_module(doc.store_id,''invoices_view_quotes'')) or (doc.order_id is not null and app.has_module(doc.store_id,''orders_recent''))) then raise exception ''FORBIDDEN'';end if;');
  end if;
  execute source;
 end loop;
end $$;
create policy detail_read on public.sales_purchase_orders as restrictive for select to authenticated using(
 (quote_id is not null and app.has_module(store_id,'invoices_view_quotes')) or (order_id is not null and app.has_module(store_id,'orders_recent')));

-- Pending invitations made before child permissions existed inherit children.
-- Parent grants remain opt-in, so no additional root module is granted.
do $$ declare fn record; source text; begin
 select p.oid into strict fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='accept_employee_invitation';
 source:=pg_get_functiondef(fn.oid);
 if position('coalesce((pair.value->>key)::boolean,false)' in source)=0 then raise exception 'Expected invitation permissions';end if;
 source:=replace(source,'coalesce((pair.value->>key)::boolean,false)','coalesce((pair.value->>key)::boolean,parent_key is not null and app.role_rank(minimum_role)<=app.role_rank(item.role))');
 execute source;
 source:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 source:=replace(source,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''detailed_permissions_v1'',exists(select 1 from pg_attribute where attrelid=to_regclass(''public.module_catalog'') and attname=''parent_key'' and not attisdropped),');
 execute source;
end $$;

-- Older access editors must not erase explicit child denials when saving roots.
do $$ declare source text; begin
 source:=pg_get_functiondef('public.set_store_module_access(uuid,uuid,jsonb,bigint)'::regprocedure);
 source:=replace(source,'current_version:=coalesce(current_version,0);',
 'p_permissions:=coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(coalesce(previous,''{}''::jsonb)) e join public.module_catalog c on c.key=e.key where c.parent_key is not null),''{}''::jsonb)||p_permissions;
 current_version:=coalesce(current_version,0);');
 execute source;
end $$;

create or replace function public.dashboard_summary(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform app.require_module(p_store,array['dashboard']);
 result:=app_private.dashboard_summary(p_store);
 if not app.has_module(p_store,'dashboard_check_stock') then result:=result-array['stock_value','retail_value','product_count','low_count','out_count','reorder_count','expiring_30','expired'];end if;
 if not app.has_module(p_store,'dashboard_credit') then result:=result-array['outstanding_credit','credit_customers','over_limit'];end if;
 return result;
end $$;
-- Financial reads reached through Invoicing require the document-list grant.
do $$ declare p record; begin
 for p in select * from pg_policies where schemaname='public' and policyname='module_read'
 and tablename in ('credit_transactions','goods_returns','customer_refunds','store_credit_allocations') loop
  execute format('alter policy module_read on public.%I using (%s)',p.tablename,replace(p.qual,'''invoices''','''invoices_view_invoices'''));
 end loop;
end $$;
