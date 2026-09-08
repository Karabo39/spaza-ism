-- Dated batches remain separate from the product catalogue and total stock.
create function app.take_sellable_batches(p_product uuid,p_store uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b record; remaining numeric:=p_quantity; taken numeric; result jsonb:='[]'; tracked boolean;
begin
 select track_expiry into tracked from public.products where id=p_product and store_id=p_store;
 if not coalesce(tracked,false) then return app.take_stock_batches(p_product,p_store,p_quantity); end if;
 for b in select * from public.stock_batches where product_id=p_product and store_id=p_store and quantity>0
   and expiry_date >= (now() at time zone 'Africa/Johannesburg')::date order by expiry_date,created_at,id for update loop
  exit when remaining<=0;
  taken:=least(remaining,b.quantity);
  update public.stock_batches set quantity=quantity-taken where id=b.id;
  result:=result||jsonb_build_array(jsonb_build_object('quantity',taken,'expiry_date',b.expiry_date,'batch_ref',b.batch_ref));
  remaining:=remaining-taken;
 end loop;
 if remaining>0 then raise exception 'INSUFFICIENT_SELLABLE_STOCK'; end if;
 return result;
end $$;
revoke all on function app.take_sellable_batches(uuid,uuid,numeric) from public,anon,authenticated;
do $$ declare f record; source text; patched integer:=0; begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('complete_sale','issue_invoice_goods') loop
  source:=pg_get_functiondef(f.oid);
  if source like '%app.take_stock_batches(%' then
   if f.proname='issue_invoice_goods' then source:=regexp_replace(source,'begin','begin perform app.cash_day_lock((select store_id from public.sales_invoices where id=p_invoice),(now() at time zone ''Africa/Johannesburg'')::date);'); end if;
   execute replace(source,'app.take_stock_batches(','app.take_sellable_batches('); patched:=patched+1;
  end if;
 end loop;
 if patched<>2 then raise exception 'Expected both stock issue implementations'; end if;
end $$;

-- A browser must not bypass tracking by clearing the flag or rewriting batches.
revoke insert,update,delete on public.stock_batches from public,anon,authenticated;
create function app.guard_expiry_tracking() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.stock where product_id=old.id and store_id=old.store_id for update;
 if old.track_expiry and not new.track_expiry and exists(select 1 from public.stock where product_id=old.id and quantity>0) then raise exception 'EXPIRY_TRACKING_REQUIRED'; end if;
 return new;
end $$;
revoke all on function app.guard_expiry_tracking() from public,anon,authenticated;
create trigger protect_expiry_tracking before update of track_expiry on public.products for each row execute function app.guard_expiry_tracking();

create function public.assign_stock_expiry(p_product uuid,p_expiry date,p_quantity numeric,p_expected numeric)
returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; total numeric; dated numeric; undated numeric; remaining numeric; b record; taken numeric;
begin
 select * into p from public.products where id=p_product;
 if not found or not app.has_store_role(p.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p.store_id,array['products']);
 select quantity into total from public.stock where product_id=p.id and store_id=p.store_id for update;
 total:=coalesce(total,0);
 if p_expiry is null or p_quantity is null or p_quantity<=0 or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<>round(p_quantity,3) then raise exception 'EXPIRY_AND_QUANTITY_REQUIRED'; end if;
 select coalesce(sum(quantity) filter(where expiry_date is not null),0),coalesce(sum(quantity),0) into dated,undated from public.stock_batches where product_id=p.id and store_id=p.store_id;
 if undated>total then raise exception 'BATCH_RECONCILIATION_REQUIRED'; end if;
 undated:=total-dated;
 if undated is distinct from p_expected or p_quantity>undated then raise exception 'STOCK_CHANGED_REFRESH'; end if;
 remaining:=p_quantity;
 for b in select * from public.stock_batches where product_id=p.id and store_id=p.store_id and expiry_date is null and quantity>0 order by created_at,id for update loop
  exit when remaining<=0; taken:=least(remaining,b.quantity);
  update public.stock_batches set quantity=quantity-taken where id=b.id; remaining:=remaining-taken;
 end loop;
 update public.products set track_expiry=true where id=p.id;
 insert into public.stock_batches(product_id,store_id,quantity,expiry_date,batch_ref) values(p.id,p.store_id,p_quantity,p_expiry,'Existing stock');
 perform app.audit('product.assign_expiry','products',p.id,p.business_id,p.store_id,null,jsonb_build_object('expiry',p_expiry,'quantity',p_quantity));
end $$;
revoke all on function public.assign_stock_expiry(uuid,date,numeric,numeric) from public,anon;
grant execute on function public.assign_stock_expiry(uuid,date,numeric,numeric) to authenticated;

create function public.save_product_details(p_product uuid,p_values jsonb,p_expiry date default null,p_expected numeric default null)
returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; total numeric; undated numeric;
begin
 select * into p from public.products where id=p_product;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p.store_id,array['products']);
 select quantity into total from public.stock where product_id=p.id and store_id=p.store_id for update;
 select greatest(coalesce(total,0)-coalesce(sum(quantity) filter(where expiry_date is not null),0),0) into undated from public.stock_batches where product_id=p.id and store_id=p.store_id;
 if coalesce((p_values->>'track_expiry')::boolean,false) and undated>0 then
  if p_expiry is null then raise exception 'EXPIRY_REQUIRED'; end if;
  perform public.assign_stock_expiry(p.id,p_expiry,undated,p_expected);
 end if;
 if nullif(btrim(p_values->>'name'),'') is null then raise exception 'PRODUCT_NAME_REQUIRED'; end if;
 update public.products set name=btrim(p_values->>'name'),cost_price=(p_values->>'cost_price')::numeric,
 selling_price=(p_values->>'selling_price')::numeric,min_stock_level=(p_values->>'min_stock_level')::numeric,
 reorder_level=(p_values->>'reorder_level')::numeric,unit=coalesce(nullif(btrim(p_values->>'unit'),''),'each'),
 track_expiry=(p_values->>'track_expiry')::boolean,is_active=(p_values->>'is_active')::boolean where id=p.id;
 perform app.audit('product.edit','products',p.id,p.business_id,p.store_id,to_jsonb(p),p_values);
end $$;
revoke all on function public.save_product_details(uuid,jsonb,date,numeric) from public,anon;
grant execute on function public.save_product_details(uuid,jsonb,date,numeric) to authenticated;

create view public.v_product_catalog with(security_invoker=true) as
 select v.*,coalesce(b.barcodes,'') barcodes,coalesce(b.barcodes,'')||' '||v.name search_text,
 x.nearest_expiry,coalesce(x.expired_quantity,0) expired_quantity,
 greatest(v.quantity-coalesce(x.dated_quantity,0),0) undated_quantity,
 case when v.track_expiry then least(v.quantity,coalesce(x.sellable_quantity,0)) else v.quantity end sellable_quantity
 from public.v_product_stock v
 left join lateral(select string_agg(barcode,', ' order by barcode) barcodes from public.product_barcodes where product_id=v.id and is_active)b on true
 left join lateral(select min(expiry_date) filter(where quantity>0) nearest_expiry,
 sum(quantity) filter(where expiry_date is not null) dated_quantity,
 sum(quantity) filter(where expiry_date<(now() at time zone 'Africa/Johannesburg')::date) expired_quantity,
 sum(quantity) filter(where expiry_date>=(now() at time zone 'Africa/Johannesburg')::date) sellable_quantity
 from public.stock_batches where product_id=v.id and store_id=v.store_id)x on true;
revoke all on public.v_product_catalog from public,anon;
grant select on public.v_product_catalog to authenticated;

-- Extend the existing snapshot without changing the physical drawer formula.
alter function app.cash_sources(uuid,date) rename to cash_drawer_sources;
create function app.cash_sources(p_store uuid,p_day date) returns jsonb language sql stable security definer set search_path='' as $$
 with bounds as(select p_day::timestamp at time zone 'Africa/Johannesburg' lo,(p_day+1)::timestamp at time zone 'Africa/Johannesburg' hi), events as(
 select case when sale_type='CASH' then 'cash_sales' when sale_type='CARD_EFT' then 'card_sales' else 'credit_issued' end kind,id,total_amount amount
 from public.goods_out,bounds where store_id=p_store and created_at>=lo and created_at<hi
 union all select 'credit_issued',i.id,greatest(i.total-coalesce((select sum(e.amount) from public.invoice_entries e where e.invoice_id=i.id and e.kind='PAYMENT' and e.created_at<=i.goods_issued_at),0),0) from public.sales_invoices i,bounds where i.store_id=p_store and i.terms='CREDIT' and i.goods_issued_at>=lo and i.goods_issued_at<hi
 union all select 'invoice_payments',id,amount from public.invoice_entries,bounds where store_id=p_store and kind='PAYMENT' and created_at>=lo and created_at<hi
 union all select 'credit_payments',id,-amount from public.credit_transactions,bounds where store_id=p_store and txn_type='PAYMENT' and reference_table is null and created_at>=lo and created_at<hi
 union all select 'refunds',id,amount from public.customer_refunds,bounds where store_id=p_store and created_at>=lo and created_at<hi
 ), totals as(select jsonb_build_object('cash_sales',coalesce(sum(amount) filter(where kind='cash_sales'),0),
 'card_sales',coalesce(sum(amount) filter(where kind='card_sales'),0),'credit_issued',coalesce(sum(amount) filter(where kind='credit_issued'),0),
 'invoice_payments',coalesce(sum(amount) filter(where kind='invoice_payments'),0),'credit_payments',coalesce(sum(amount) filter(where kind='credit_payments'),0),
 'refunds',coalesce(sum(amount) filter(where kind='refunds'),0),
 'net_collected',coalesce(sum(case when kind='refunds' then -amount when kind='credit_issued' then 0 else amount end),0)) activity,
 coalesce(string_agg(kind||id::text||amount::text,',' order by kind,id),'') fingerprint from events), drawer as(select app.cash_drawer_sources(p_store,p_day) value)
 select value||jsonb_build_object('activity',activity,'fingerprint',md5((value->>'fingerprint')||totals.fingerprint)) from drawer,totals;
$$;
revoke all on function app.cash_sources(uuid,date),app.cash_drawer_sources(uuid,date) from public,anon,authenticated;
-- All payment methods participate in the same snapshot lock.
drop trigger lock_cash_source on public.goods_out;
create trigger lock_cash_source before insert on public.goods_out for each row execute function app.lock_cash_source();
drop trigger lock_cash_source on public.invoice_entries;
create trigger lock_cash_source before insert on public.invoice_entries for each row when(new.kind='PAYMENT') execute function app.lock_cash_source();
drop trigger lock_cash_source on public.customer_refunds;
create trigger lock_cash_source before insert on public.customer_refunds for each row execute function app.lock_cash_source();

create or replace function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
    'batch_expiry_v1', to_regprocedure('app.take_sellable_batches(uuid,uuid,numeric)') is not null and to_regclass('public.v_product_catalog') is not null,
    'employee_invitations_v1', to_regprocedure('public.accept_employee_invitation(uuid,text,text,text,text)') is not null and to_regprocedure('public.my_employee_setup()') is not null,
    'document_workflows_v1', to_regprocedure('public.convert_quote(uuid,jsonb,bigint)') is not null and to_regprocedure('public.return_refund_summary(uuid)') is not null and to_regprocedure('public.stock_export(uuid,text,text)') is not null and to_regprocedure('public.download_purchase_order(uuid)') is not null,
    'order_workflow_v1', to_regprocedure('public.order_workflow_summary(uuid)') is not null,
    'brd_v102', to_regprocedure('public.invoice_summary(uuid)') is not null
      and exists(select 1 from pg_attribute where attrelid=to_regclass('public.stores') and attname='location_type' and not attisdropped),
    'module_access_v1', to_regprocedure('public.my_module_access(uuid)') is not null
      and to_regprocedure('public.set_store_module_access(uuid,uuid,jsonb,bigint)') is not null,
    'cash_up_v1', to_regprocedure('public.cash_up_summary(uuid,date)') is not null
      and to_regprocedure('public.submit_cash_up(uuid,numeric,jsonb,text,text,uuid)') is not null
  ));
$$;
revoke all on function public.app_schema_status() from public;
grant execute on function public.app_schema_status() to anon,authenticated,service_role;
