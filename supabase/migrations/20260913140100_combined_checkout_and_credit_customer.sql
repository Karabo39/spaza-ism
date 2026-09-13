-- Keep historical CARD/EFT rows and idempotency payloads intact.
alter table public.sale_payments drop constraint sale_payments_method_check;
alter table public.sale_payments add constraint sale_payments_method_check check(method in ('CASH','CARD','EFT','CARD_EFT'));
CREATE OR REPLACE FUNCTION public.complete_checkout(p_store uuid, p_items jsonb, p_payments jsonb, p_request uuid, p_customer uuid DEFAULT NULL::uuid, p_credit boolean DEFAULT false, p_override boolean DEFAULT false, p_override_token uuid DEFAULT NULL::uuid, p_till text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare payload jsonb; existing public.goods_out%rowtype; pay jsonb; item jsonb; method text;
 amount numeric; total numeric:=0; paid numeric:=0; noncash numeric:=0; cash numeric:=0; cash_applied numeric; sid uuid; loc public.stores%rowtype; biz public.businesses%rowtype; doc jsonb;
begin
 perform app.require_module(p_store,array['goods_out']);
 if auth.uid() is null then raise exception 'FORBIDDEN';end if;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 if p_credit is null or p_override is null then raise exception 'INVALID_PAYMENT';end if;
 if length(coalesce(p_till,''))>80 then raise exception 'INVALID_TILL';end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then raise exception 'NO_ITEMS';end if;
 if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments)>3 then raise exception 'INVALID_PAYMENT';end if;
 payload:=jsonb_build_object('user',auth.uid(),'items',p_items,'payments',p_payments,'customer',p_customer,'credit',p_credit,'override',p_override,'till',p_till);
 perform pg_advisory_xact_lock(hashtextextended(app.store_business(p_store)::text||p_request::text,0));
 select * into existing from public.goods_out where business_id=app.store_business(p_store) and request_id=p_request;
 if found then
  if existing.store_id<>p_store or not exists(select 1 from public.sale_receipts where sale_id=existing.id and request_payload=payload) then raise exception 'REQUEST_CONFLICT';end if;
  return existing.id;
 end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if (item->>'unit_price') is null or (item->>'unit_price')::numeric::text in ('NaN','Infinity','-Infinity') or (item->>'unit_price')::numeric<0 or (item->>'unit_price')::numeric<>round((item->>'unit_price')::numeric,2) then raise exception 'INVALID_PRICE';end if;
  if (item->>'quantity') is null or (item->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric<>round((item->>'quantity')::numeric,3) then raise exception 'INVALID_QUANTITY';end if;
  total:=total+round((item->>'quantity')::numeric*(item->>'unit_price')::numeric,2);
 end loop;
 if total<=0 then raise exception 'INVALID_SALE_TOTAL';end if;
 if (select count(*)<>count(distinct value->>'method') from jsonb_array_elements(p_payments)) then raise exception 'DUPLICATE_PAYMENT_METHOD';end if;
 for pay in select value from jsonb_array_elements(p_payments) loop
  method:=pay->>'method';amount:=(pay->>'amount')::numeric;
  if method is null or method not in ('CASH','CARD','EFT','CARD_EFT') or amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount<>round(amount,2) or amount>999999999999.99 then raise exception 'INVALID_PAYMENT';end if;
  if length(coalesce(pay->>'reference',''))>200 then raise exception 'INVALID_PAYMENT_REFERENCE';end if;
  if method<>'CASH' and (pay->>'confirmed')::boolean is distinct from true then raise exception 'PAYMENT_CONFIRMATION_REQUIRED';end if;
  paid:=paid+amount;
  if method='CASH' then cash:=amount;else noncash:=noncash+amount;end if;
 end loop;
 if p_credit then
  if jsonb_array_length(p_payments)<>0 then raise exception 'CREDIT_PAYMENT_NOT_ALLOWED';end if;
 else
  if paid<total then raise exception 'PAYMENT_UNDERPAID';end if;
  if noncash>total or (cash>0 and noncash>=total) then raise exception 'NONCASH_OVERPAYMENT';end if;
 end if;
 sid:=public.complete_sale(p_store,case when p_credit then 'CREDIT' when noncash>0 then 'CARD_EFT' else 'CASH' end,p_customer,p_items,p_override,null,p_request,null,p_override_token);
 select * into loc from public.stores where id=p_store;
 select * into biz from public.businesses where id=loc.business_id;
 cash_applied:=case when p_credit then 0 else total-noncash end;
 doc:=jsonb_build_object('id',sid,'reference','POS-'||upper(replace(sid::text,'-','')),'store',loc.name,'business',biz.name,'currency',loc.currency,
  'cashier',coalesce(nullif((select full_name from public.profiles where id=auth.uid()),''),'Team member'),'cashier_id',auth.uid(),'till',nullif(btrim(p_till),''),
  'created_at',(select created_at from public.goods_out where id=sid),'total',total,'discount',0,'tax',null,'status',case when p_credit then 'CREDIT' else 'PAID' end,
  'customer_id',p_customer,'customer_name',(select name from public.customers where id=p_customer and store_id=p_store),'cash_tendered',cash,'change',case when cash>0 then cash-cash_applied else 0 end,
  'items',(select jsonb_agg(jsonb_build_object('name',p.name,'unit',p.unit,'quantity',i.quantity,'unit_price',i.unit_price,'total',i.line_total) order by i.id) from public.goods_out_items i join public.products p on p.id=i.product_id where i.goods_out_id=sid),
  'payments',(select coalesce(jsonb_agg(jsonb_build_object('method',value->>'method','amount',case when value->>'method'='CASH' then cash_applied else (value->>'amount')::numeric end,'reference',nullif(btrim(value->>'reference'),'')) order by value->>'method'),'[]') from jsonb_array_elements(p_payments)));
 insert into public.sale_receipts(sale_id,store_id,reference,snapshot,request_payload) values(sid,p_store,doc->>'reference',doc,payload);
 insert into public.sale_payments(sale_id,method,amount,tendered,reference,confirmed_by)
 select sid,value->>'method',case when value->>'method'='CASH' then cash_applied else (value->>'amount')::numeric end,(value->>'amount')::numeric,nullif(btrim(value->>'reference'),''),auth.uid() from jsonb_array_elements(p_payments);
 perform app.audit('checkout.complete','goods_out',sid,loc.business_id,p_store,null,jsonb_build_object('payments',doc->'payments','customer_id',p_customer,'customer_name',(select name from public.customers where id=p_customer and store_id=p_store),'cash_tendered',cash,'change',doc->'change'));
 return sid;
end $function$
;

do $$ declare src text;begin
 src:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 src:=replace(src,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''warehouse_receiving_v1'',to_regprocedure(''public.transfer_detail(uuid)'') is not null and to_regprocedure(''public.correct_batch_expiry(uuid,date,date,numeric,text)'') is not null,');
 execute src;
end $$;
