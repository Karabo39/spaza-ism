-- Keep existing references immutable. New receipts and transfers use business-wide
-- daily counters, consistently with ORD/INV/QUO/RET (South African calendar day).
alter table public.stock_transfers drop constraint stock_transfers_reference_key;
alter table public.stock_transfers add unique(business_id,reference);
create trigger document_reference before insert or update of reference on public.stock_transfers
for each row execute function app_private.assign_document_reference('TR');

-- A receipt has store_id rather than business_id. The existing checkout transaction
-- and request lock run before this insert, so replay does not consume another number.
alter table public.sale_receipts drop constraint sale_receipts_reference_key;
alter table public.sale_receipts add unique(store_id,reference);
create function app_private.assign_receipt_reference() returns trigger
language plpgsql security definer set search_path='' as $$
declare b uuid; n bigint; d date:=(statement_timestamp() at time zone 'Africa/Johannesburg')::date;
begin
 select business_id into strict b from public.stores where id=new.store_id;
 insert into app_private.document_sequences as seq values(b,'POS',d,1)
 on conflict(business_id,kind,day) do update set value=seq.value+1 returning value into n;
 new.reference:='POS-'||to_char(d,'YYYYMMDD')||'-'||lpad(n::text,greatest(3,length(n::text)),'0');
 new.snapshot:=jsonb_set(new.snapshot,'{reference}',to_jsonb(new.reference));
 return new;
end $$;
revoke all on function app_private.assign_receipt_reference() from public,anon,authenticated;
create trigger document_reference before insert on public.sale_receipts
for each row execute function app_private.assign_receipt_reference();

-- Receipt and approval are independent. Approved document content stays protected;
-- changing receipt alone must not replace the original manager's approval identity.
alter table public.sales_purchase_orders drop constraint sales_purchase_orders_check1;
create or replace function public.save_purchase_order(p_quote uuid,p_order uuid,p_received boolean,p_approved boolean,p_reference text,p_filename text,p_mime text,p_content text,p_expected bigint) returns void
language plpgsql security definer set search_path='' as $$
declare loc uuid; old public.sales_purchase_orders%rowtype; bytes bytea;
begin
 if (p_quote is null)=(p_order is null) then raise exception 'DOCUMENT_REQUIRED'; end if;
 if p_quote is not null then select store_id into loc from public.sales_quotes where id=p_quote for update; else select store_id into loc from public.sales_orders where id=p_order for update; end if;
 perform app.require_module(loc,case when p_quote is not null then array['invoices_view_quotes'] else array['orders_recent'] end);
 if p_order is not null then perform 1 from public.sales_quotes where order_id=p_order for update;end if;
 if exists(select 1 from public.sales_quotes where (id=p_quote or order_id=p_order) and status in ('ACCEPTED','CONVERTED','CANCELLED')) then raise exception 'PURCHASE_ORDER_LOCKED';end if;
 select * into old from public.sales_purchase_orders where (p_quote is not null and quote_id=p_quote) or (p_order is not null and order_id=p_order) for update;
 if coalesce(old.version,0) is distinct from p_expected then raise exception 'PO_CHANGED_REFRESH'; end if;
 if p_received is null or p_approved is null then raise exception 'INVALID_PO_STATE'; end if;
 if (p_approved is distinct from coalesce(old.approved,false) or (old.approved and (p_content is not null or p_reference is distinct from old.reference))) and not app.has_store_role(loc,'manager') then raise exception 'FORBIDDEN'; end if;
 if p_content is not null then
  if length(p_content)>2800000 or p_mime not in ('application/pdf','image/png','image/jpeg') or p_mime is null or nullif(p_filename,'') is null or length(p_filename)>180 then raise exception 'INVALID_PO_FILE'; end if;
  bytes:=decode(p_content,'base64');
  if octet_length(bytes) not between 1 and 2097152 then raise exception 'INVALID_PO_FILE'; end if;
 end if;
 if old.id is null then
  insert into public.sales_purchase_orders(store_id,quote_id,order_id,received,approved,reference,filename,mime,content,updated_by,approved_by,approved_at)
  values(loc,p_quote,coalesce(p_order,(select order_id from public.sales_quotes where id=p_quote)),p_received,p_approved,p_reference,p_filename,p_mime,bytes,auth.uid(),case when p_approved then auth.uid() end,case when p_approved then now() end);
 else
  update public.sales_purchase_orders set received=p_received,approved=p_approved,reference=p_reference,
   filename=case when bytes is null then filename else p_filename end,mime=case when bytes is null then mime else p_mime end,content=coalesce(bytes,content),version=version+1,updated_by=auth.uid(),updated_at=now(),
   approved_by=case when p_approved then case when old.approved and bytes is null and p_reference is not distinct from old.reference then old.approved_by else auth.uid() end end,
   approved_at=case when p_approved then case when old.approved and bytes is null and p_reference is not distinct from old.reference then old.approved_at else now() end end where id=old.id;
 end if;
 perform app.audit('document.purchase_order','sales_orders',coalesce(p_order,p_quote),app.store_business(loc),loc,
  case when old.id is not null then jsonb_build_object('received',old.received,'approved',old.approved,'reference',old.reference,'filename',old.filename,'approved_by',old.approved_by,'approved_at',old.approved_at) end,
  (select jsonb_build_object('received',po.received,'approved',po.approved,'reference',po.reference,'filename',po.filename,'approved_by',po.approved_by,'approved_at',po.approved_at) from public.sales_purchase_orders po where (p_quote is not null and po.quote_id=p_quote) or (p_order is not null and po.order_id=p_order)));
end $$;
revoke all on function public.save_purchase_order(uuid,uuid,boolean,boolean,text,text,text,text,bigint) from public,anon;
grant execute on function public.save_purchase_order(uuid,uuid,boolean,boolean,text,text,text,text,bigint) to authenticated;

do $$declare s text;begin
 s:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 s:=regexp_replace(s,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''mixed_document_refinements_v1'',true,');execute s;
end $$;
