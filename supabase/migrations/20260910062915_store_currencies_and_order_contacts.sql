-- Each location keeps its own currency. Existing locations inherit their business currency.
alter table public.stores add column currency text;
update public.stores s set currency=b.currency from public.businesses b where b.id=s.business_id;
alter table public.stores alter column currency set not null;
create function app.store_currency_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then new.currency:=coalesce(new.currency,(select currency from public.businesses where id=new.business_id));
 if not(new.currency=any(array['AED','AFN','ALL','AMD','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XCG','XOF','XPF','YER','ZAR','ZMW','ZWG'])) then raise exception 'INVALID_CURRENCY';end if;
 return new;end if;
 if new.currency is not distinct from old.currency then return new;end if;
 if not app.has_store_role(old.id,'owner') then raise exception 'FORBIDDEN';end if;
 perform app.require_module(old.id,array['settings']);
 if not(new.currency=any(array['AED','AFN','ALL','AMD','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XCG','XOF','XPF','YER','ZAR','ZMW','ZWG'])) then raise exception 'INVALID_CURRENCY';end if;
 -- History cannot be relabelled. Choose the currency before stocking/trading.
 if exists(select 1 from public.products where store_id=old.id) or exists(select 1 from public.customers where store_id=old.id)
 or exists(select 1 from public.goods_in where store_id=old.id) or exists(select 1 from public.goods_out where store_id=old.id)
 or exists(select 1 from public.cash_ups where store_id=old.id) or exists(select 1 from public.sales_orders where store_id=old.id) or exists(select 1 from public.stock_transfers where source_id=old.id or destination_id=old.id)
 then raise exception 'STORE_CURRENCY_HAS_HISTORY';end if;
 return new;
end $$;
revoke all on function app.store_currency_guard() from public,anon,authenticated;
create trigger store_currency_guard before insert or update of currency on public.stores for each row execute function app.store_currency_guard();
-- First pricing/customer/cash activity serializes against currency changes.
create function app.lock_store_currency() returns trigger language plpgsql security definer set search_path='' as $$
begin perform 1 from public.stores where id=new.store_id for share;return new;end $$;
revoke all on function app.lock_store_currency() from public,anon,authenticated;
create trigger product_currency_lock before insert on public.products for each row execute function app.lock_store_currency();
create trigger customer_currency_lock before insert on public.customers for each row execute function app.lock_store_currency();
create trigger cash_currency_lock before insert on public.cash_ups for each row execute function app.lock_store_currency();
create trigger receipt_currency_lock before insert on public.goods_in for each row execute function app.lock_store_currency();
create function public.set_store_currency(p_store uuid,p_currency text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not app.has_store_role(p_store,'owner') then raise exception 'FORBIDDEN';end if;
 perform app.require_module(p_store,array['settings']);
 if p_currency is null then raise exception 'INVALID_CURRENCY';end if;
 perform 1 from public.stores where id=p_store for update;
 update public.stores set currency=p_currency where id=p_store;
 perform app.audit('store.currency','stores',p_store,app.store_business(p_store),p_store,null,jsonb_build_object('currency',p_currency));
end $$;
revoke all on function public.set_store_currency(uuid,text) from public,anon;
grant execute on function public.set_store_currency(uuid,text) to authenticated;
-- Preserve invoice snapshots; future invoices read their own store currency.
do $$ declare f record; source text; patched integer:=0;begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('create_sales_invoice','claim_notification_deliveries') loop
 source:=pg_get_functiondef(f.oid);
 if source like '%b.currency%' then execute replace(source,'b.currency','s.currency');patched:=patched+1;end if;
 end loop;
 if patched<1 then raise exception 'Invoice currency implementation missing';end if;
end $$;

create function public.create_order_with_contact(p_store uuid,p_customer uuid,p_items jsonb,p_request uuid,p_note text default null,p_guest jsonb default null) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; result uuid; previous public.sales_orders%rowtype; payload jsonb;
begin
 perform app.require_module(p_store,array['orders']);
 if p_guest is null then return public.create_sales_order(p_store,p_customer,p_items,p_request,p_note);end if;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 if p_customer is not null or jsonb_typeof(p_guest)<>'object' or nullif(btrim(p_guest->>'name'),'') is null or length(p_guest->>'name')>200 or length(coalesce(p_guest->>'phone',''))>50 or length(coalesce(p_guest->>'address',''))>1000 then raise exception 'INVALID_QUOTE_CONTACT';end if;
 payload:=jsonb_build_object('user',auth.uid(),'store',p_store,'guest',p_guest,'items',p_items,'note',p_note);
 perform pg_advisory_xact_lock(hashtextextended(app.store_business(p_store)::text||p_request::text,0));
 select * into previous from public.sales_orders where business_id=app.store_business(p_store) and request_id=p_request;
 if found then if previous.request_payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return previous.id;end if;
 insert into public.customers(business_id,store_id,name,phone,address,is_once_off) values(app.store_business(p_store),p_store,btrim(p_guest->>'name'),nullif(btrim(p_guest->>'phone'),''),nullif(btrim(p_guest->>'address'),''),true) returning id into cid;
 result:=public.create_sales_order(p_store,cid,p_items,p_request,p_note);
 update public.sales_orders set request_payload=payload where id=result;
 return result;
end $$;
revoke all on function public.create_order_with_contact(uuid,uuid,jsonb,uuid,text,jsonb) from public,anon;
grant execute on function public.create_order_with_contact(uuid,uuid,jsonb,uuid,text,jsonb) to authenticated;

-- Document email uses the same capped, idempotent delivery ledger, with document module authorization.
create function public.prepare_document_email(p_type text,p_document uuid,p_request uuid,p_hash text,p_recipient text) returns jsonb language plpgsql security definer set search_path='' as $$
declare loc uuid;
begin
 if p_type='invoice' then select store_id into loc from public.sales_invoices where id=p_document;perform app.require_module(loc,array['invoices']);
 elsif p_type='return' then select store_id into loc from public.goods_returns where id=p_document and status='APPROVED';perform app.require_module(loc,array['returns']);
 else raise exception 'INVALID_DOCUMENT';end if;
 return app_private.prepare_report_email(loc,p_request,p_hash,p_recipient);
end $$;
revoke all on function public.prepare_document_email(text,uuid,uuid,text,text) from public,anon;
grant execute on function public.prepare_document_email(text,uuid,uuid,text,text) to authenticated;

create function app.same_currency_transfer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.stores where id in (new.source_id,new.destination_id) order by id for share;
 if (select currency from public.stores where id=new.source_id) is distinct from (select currency from public.stores where id=new.destination_id) then raise exception 'TRANSFER_CURRENCY_MISMATCH';end if;
 return new;
end $$;
revoke all on function app.same_currency_transfer() from public,anon,authenticated;
create trigger transfer_currency_guard before insert on public.stock_transfers for each row execute function app.same_currency_transfer();

create or replace function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
    'store_currency_v1', to_regprocedure('public.set_store_currency(uuid,text)') is not null and to_regprocedure('public.create_order_with_contact(uuid,uuid,jsonb,uuid,text,jsonb)') is not null,
    'document_email_v1', to_regprocedure('public.prepare_document_email(text,uuid,uuid,text,text)') is not null,
    'invoice_refinements_v1', to_regprocedure('public.returnable_documents(uuid,text)') is not null and to_regprocedure('public.save_quote(uuid,uuid,jsonb,date,numeric,text,uuid,uuid,bigint,jsonb)') is not null and to_regprocedure('public.use_invoice_customer_credit(uuid,uuid)') is not null,
    'cash_shifts_v1', to_regprocedure('public.start_next_cash_shift(uuid,numeric,text,uuid)') is not null,
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
