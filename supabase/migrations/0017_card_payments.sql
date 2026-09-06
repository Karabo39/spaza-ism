-- Card/EFT is a recorded payment type, not a payment processor.
alter type app.sale_type add value if not exists 'CARD_EFT';
alter type app.movement_type add value if not exists 'SALE_CARD';
alter table public.goods_out add column request_id uuid;
alter table public.goods_out add column request_payload jsonb;
alter table public.goods_out add column payment_reference text;
create unique index goods_out_request on public.goods_out(business_id,request_id) where request_id is not null;
drop function public.complete_sale(uuid,text,uuid,jsonb,boolean,text);
create or replace function public.complete_sale(
  p_store uuid, p_sale_type text, p_customer uuid, p_items jsonb,
  p_override boolean default false, p_note text default null, p_request uuid default null, p_payment_reference text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_existing public.goods_out%rowtype; v_payload jsonb; v_biz uuid; v_go uuid; v_item jsonb; v_type app.sale_type;
  v_pid uuid; v_qty numeric; v_price numeric; v_line numeric; v_total numeric := 0;
  v_acct public.credit_accounts%rowtype;
  v_new_balance numeric; v_mtype app.movement_type; v_override boolean := false;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'NO_ITEMS'; end if;
  v_type := upper(p_sale_type)::app.sale_type;
  v_biz := app.store_business(p_store);
  v_mtype := case when v_type = 'CASH' then 'SALE_CASH' when v_type = 'CARD_EFT' then 'SALE_CARD' else 'SALE_CREDIT' end;
  v_payload:=jsonb_build_object('user',auth.uid(),'store',p_store,'type',v_type,'customer',p_customer,'items',p_items,'override',p_override,'note',p_note,'reference',p_payment_reference);
  if p_request is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_biz::text||p_request::text,0));
    select * into v_existing from public.goods_out where business_id=v_biz and request_id=p_request;
    if found then
      if v_existing.request_payload<>v_payload then raise exception 'REQUEST_CONFLICT'; end if;
      return v_existing.id;
    end if;
  end if;

  if v_type = 'CREDIT' then
    if p_customer is null then raise exception 'CUSTOMER_REQUIRED'; end if;
    select * into v_acct from public.credit_accounts
      where customer_id = p_customer and store_id = p_store for update;
    if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  end if;

  insert into public.goods_out
    (business_id, store_id, sale_type, customer_id, note, performed_by,request_id,request_payload,payment_reference)
  values (v_biz, p_store, v_type, case when v_type='CREDIT' then p_customer else null end, p_note, auth.uid(),p_request,v_payload,nullif(btrim(p_payment_reference),''))
  returning id into v_go;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty<>round(v_qty,3) then raise exception 'INVALID_QUANTITY'; end if;

    -- authoritative price: use provided unit_price if present else product selling price
    select coalesce(nullif(v_item->>'unit_price','')::numeric, selling_price)
      into v_price
      from public.products
      where id = v_pid and store_id = p_store and is_active;
    if v_price is null then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE: %', v_pid; end if;
    if v_price < 0 or v_price::text in ('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRICE'; end if;

    v_price := round(v_price,2);
    v_line := round(v_qty * v_price, 2);
    v_total := v_total + v_line;

    insert into public.goods_out_items (goods_out_id, product_id, quantity, unit_price, line_total)
    values (v_go, v_pid, v_qty, v_price, v_line);

    perform app.apply_stock_delta(v_biz, p_store, v_pid, -v_qty, v_mtype,
      v_type||' sale', 'goods_out', v_go, null);
    perform app.take_stock_batches(v_pid,p_store,v_qty);
  end loop;

  if v_type = 'CREDIT' then
    v_new_balance := v_acct.balance + v_total;
    if v_new_balance > v_acct.credit_limit then
      if not coalesce(p_override,false) then
        raise exception 'CREDIT_LIMIT_EXCEEDED: balance % would exceed limit %',
          v_new_balance, v_acct.credit_limit using errcode = 'check_violation';
      end if;
      -- override requires manager+
      if not app.has_store_role(p_store,'manager') then
        raise exception 'OVERRIDE_NOT_AUTHORIZED';
      end if;
      v_override := true;
    end if;

    update public.credit_accounts set balance = v_new_balance where id = v_acct.id;
    insert into public.credit_transactions
      (credit_account_id, business_id, store_id, txn_type, amount, balance_after,
       reference_table, reference_id, performed_by, note)
    values (v_acct.id, v_biz, p_store, 'CREDIT_SALE', v_total, v_new_balance,
       'goods_out', v_go, auth.uid(), p_note);

    update public.goods_out
      set credit_override = v_override,
          authorized_by = case when v_override then auth.uid() else null end
      where id = v_go;
  end if;

  update public.goods_out set total_amount = v_total where id = v_go;

  perform app.audit('goods_out.complete','goods_out',v_go,v_biz,p_store,null,
    jsonb_build_object('sale_type',v_type,'total',v_total,'override',v_override));
  return v_go;
end $$;
revoke execute on function public.complete_sale(uuid,text,uuid,jsonb,boolean,text,uuid,text) from public,anon;
grant execute on function public.complete_sale(uuid,text,uuid,jsonb,boolean,text,uuid,text) to authenticated;

create function app.require_receipt_expiry() returns trigger language plpgsql security definer set search_path=public,app as $$
begin
  if new.expiry_date is null and exists(select 1 from public.products where id=new.product_id and track_expiry) then raise exception 'EXPIRY_REQUIRED'; end if;
  return new;
end $$;
create trigger trg_goods_in_expiry before insert on public.goods_in_items for each row execute function app.require_receipt_expiry();
revoke execute on function app.require_receipt_expiry() from public,anon,authenticated;
