-- =====================================================================
-- 0006_rpcs.sql
-- Atomic, authoritative operations. All are SECURITY DEFINER and perform
-- their own authorization (RLS is bypassed inside them). Each PL/pgSQL
-- function body runs in a single transaction: any exception rolls back
-- the whole operation. Concurrency is handled with SELECT ... FOR UPDATE
-- on the stock/credit row plus the stock_non_negative CHECK constraint.
-- =====================================================================

-- ---- audit helper ----
create or replace function app.audit(
  p_action text, p_entity text, p_entity_id uuid,
  p_business uuid, p_store uuid, p_before jsonb default null, p_after jsonb default null)
returns void language sql security definer set search_path = public, app as $$
  insert into public.audit_logs
    (business_id, store_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values (p_business, p_store, auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- ---- core movement primitive ----
-- Locks (or creates) the stock row, validates the resulting quantity,
-- updates stock, and appends exactly one ledger row. Returns new qty.
create or replace function app.apply_stock_delta(
  p_business uuid, p_store uuid, p_product uuid, p_delta numeric,
  p_type app.movement_type, p_reason text, p_ref_table text, p_ref_id uuid,
  p_unit_cost numeric default null)
returns numeric language plpgsql security definer set search_path = public, app as $$
declare
  v_before numeric(14,3);
  v_after  numeric(14,3);
begin
  -- Ensure a stock row exists, then lock it (serializes concurrent writers).
  insert into public.stock (product_id, store_id, quantity)
  values (p_product, p_store, 0)
  on conflict (product_id, store_id) do nothing;

  select quantity into v_before from public.stock
  where product_id = p_product and store_id = p_store
  for update;

  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'INSUFFICIENT_STOCK: product % has % available, tried to remove %',
      p_product, v_before, -p_delta using errcode = 'check_violation';
  end if;

  update public.stock set quantity = v_after
  where product_id = p_product and store_id = p_store;

  insert into public.stock_movements
    (business_id, store_id, product_id, movement_type, quantity_delta,
     quantity_before, quantity_after, unit_cost, reason, reference_table,
     reference_id, performed_by)
  values (p_business, p_store, p_product, p_type, p_delta, v_before, v_after,
     p_unit_cost, p_reason, p_ref_table, p_ref_id, auth.uid());

  return v_after;
end $$;

-- ---- auto-create credit account when a customer is created ----
create or replace function app.handle_new_customer()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  insert into public.credit_accounts (customer_id, business_id, store_id, balance, credit_limit)
  values (new.id, new.business_id, new.store_id, 0, 0)
  on conflict (customer_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_new_customer on public.customers;
create trigger trg_new_customer after insert on public.customers
  for each row execute function app.handle_new_customer();

-- =====================================================================
-- Onboarding: create a business + owner membership + first store atomically
-- =====================================================================
create or replace function public.create_business(p_name text, p_store_name text default 'Main Store')
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare v_uid uuid := auth.uid(); v_biz uuid; v_store uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  insert into public.businesses (name, created_by) values (btrim(p_name), v_uid)
  returning id into v_biz;
  insert into public.memberships (business_id, user_id, role) values (v_biz, v_uid, 'owner');
  insert into public.stores (business_id, name) values (v_biz, coalesce(btrim(p_store_name),'Main Store'))
  returning id into v_store;
  perform app.audit('business.create','business',v_biz,v_biz,v_store,null,
    jsonb_build_object('name',p_name));
  return jsonb_build_object('business_id', v_biz, 'store_id', v_store);
end $$;

-- =====================================================================
-- create_product: product + optional barcode + zero stock row, atomic.
-- =====================================================================
create or replace function public.create_product(
  p_store uuid, p_name text, p_barcode text default null,
  p_category uuid default null, p_supplier uuid default null,
  p_cost numeric default 0, p_selling numeric default 0,
  p_min numeric default 0, p_reorder numeric default 0,
  p_unit text default 'each', p_track_expiry boolean default false)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_biz uuid; v_pid uuid;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  v_biz := app.store_business(p_store);
  insert into public.products
    (business_id, store_id, name, category_id, default_supplier_id, cost_price,
     selling_price, min_stock_level, reorder_level, unit, track_expiry, created_by)
  values (v_biz, p_store, btrim(p_name), p_category, p_supplier, p_cost, p_selling,
     p_min, p_reorder, coalesce(p_unit,'each'), p_track_expiry, auth.uid())
  returning id into v_pid;

  insert into public.stock (product_id, store_id, quantity) values (v_pid, p_store, 0)
  on conflict do nothing;

  if p_barcode is not null and btrim(p_barcode) <> '' then
    insert into public.product_barcodes (product_id, store_id, barcode)
    values (v_pid, p_store, btrim(p_barcode));
  end if;

  perform app.audit('product.create','product',v_pid,v_biz,p_store,null,
    jsonb_build_object('name',p_name,'barcode',p_barcode));
  return v_pid;
end $$;

-- =====================================================================
-- receive_stock (Goods In)
--   p_items: [{product_id, quantity, unit_cost, expiry_date, batch_ref}]
-- =====================================================================
create or replace function public.receive_stock(
  p_store uuid, p_supplier uuid, p_reference text, p_note text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_biz uuid; v_gi uuid; v_item jsonb;
  v_pid uuid; v_qty numeric; v_cost numeric; v_line numeric; v_total numeric := 0;
  v_exp date; v_batch text;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'NO_ITEMS'; end if;
  v_biz := app.store_business(p_store);

  insert into public.goods_in (business_id, store_id, supplier_id, reference, note, performed_by)
  values (v_biz, p_store, p_supplier, nullif(btrim(coalesce(p_reference,'')),''), p_note, auth.uid())
  returning id into v_gi;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid  := (v_item->>'product_id')::uuid;
    v_qty  := (v_item->>'quantity')::numeric;
    v_cost := coalesce((v_item->>'unit_cost')::numeric, 0);
    v_exp  := nullif(v_item->>'expiry_date','')::date;
    v_batch:= nullif(v_item->>'batch_ref','');
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;

    perform 1 from public.products
      where id = v_pid and store_id = p_store and is_active
      for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE: %', v_pid; end if;

    v_line := round(v_qty * v_cost, 2);
    v_total := v_total + v_line;

    insert into public.goods_in_items
      (goods_in_id, product_id, quantity, unit_cost, expiry_date, batch_ref, line_total)
    values (v_gi, v_pid, v_qty, v_cost, v_exp, v_batch, v_line);

    perform app.apply_stock_delta(v_biz, p_store, v_pid, v_qty, 'GOODS_IN',
      'Goods In '||coalesce(p_reference,''), 'goods_in', v_gi, v_cost);

    -- update cost price if provided (>0); trigger records price history
    if v_cost > 0 then
      update public.products set cost_price = v_cost where id = v_pid and cost_price is distinct from v_cost;
    end if;

    -- expiry batch tracking
    if v_exp is not null then
      insert into public.stock_batches (product_id, store_id, batch_ref, expiry_date, quantity)
      values (v_pid, p_store, v_batch, v_exp, v_qty);
    end if;
  end loop;

  update public.goods_in set total_cost = v_total where id = v_gi;
  if p_supplier is not null and nullif(btrim(coalesce(p_reference,'')),'') is not null then
    insert into public.supplier_invoices (business_id, store_id, supplier_id, goods_in_id, reference, amount)
    values (v_biz, p_store, p_supplier, v_gi, p_reference, v_total);
  end if;

  perform app.audit('goods_in.complete','goods_in',v_gi,v_biz,p_store,null,
    jsonb_build_object('total_cost',v_total,'items',jsonb_array_length(p_items)));
  return v_gi;
end $$;

-- =====================================================================
-- complete_sale (Goods Out: cash or credit)
--   p_items: [{product_id, quantity, unit_price?}]
-- =====================================================================
create or replace function public.complete_sale(
  p_store uuid, p_sale_type text, p_customer uuid, p_items jsonb,
  p_override boolean default false, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_biz uuid; v_go uuid; v_item jsonb; v_type app.sale_type;
  v_pid uuid; v_qty numeric; v_price numeric; v_line numeric; v_total numeric := 0;
  v_acct public.credit_accounts%rowtype;
  v_new_balance numeric; v_mtype app.movement_type; v_override boolean := false;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'NO_ITEMS'; end if;
  v_type := upper(p_sale_type)::app.sale_type;
  v_biz := app.store_business(p_store);
  v_mtype := case when v_type = 'CASH' then 'SALE_CASH' else 'SALE_CREDIT' end;

  if v_type = 'CREDIT' then
    if p_customer is null then raise exception 'CUSTOMER_REQUIRED'; end if;
    select * into v_acct from public.credit_accounts
      where customer_id = p_customer and store_id = p_store for update;
    if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  end if;

  insert into public.goods_out
    (business_id, store_id, sale_type, customer_id, note, performed_by)
  values (v_biz, p_store, v_type, p_customer, p_note, auth.uid())
  returning id into v_go;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;

    -- authoritative price: use provided unit_price if present else product selling price
    select coalesce(nullif(v_item->>'unit_price','')::numeric, selling_price)
      into v_price
      from public.products
      where id = v_pid and store_id = p_store and is_active;
    if v_price is null then raise exception 'PRODUCT_NOT_FOUND_OR_INACTIVE: %', v_pid; end if;
    if v_price < 0 then raise exception 'INVALID_PRICE'; end if;

    v_line := round(v_qty * v_price, 2);
    v_total := v_total + v_line;

    insert into public.goods_out_items (goods_out_id, product_id, quantity, unit_price, line_total)
    values (v_go, v_pid, v_qty, v_price, v_line);

    perform app.apply_stock_delta(v_biz, p_store, v_pid, -v_qty, v_mtype,
      v_type||' sale', 'goods_out', v_go, null);
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

-- =====================================================================
-- record_credit_payment (never touches stock)
-- =====================================================================
create or replace function public.record_credit_payment(
  p_customer uuid, p_amount numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_acct public.credit_accounts%rowtype; v_new numeric; v_txn uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  select * into v_acct from public.credit_accounts where customer_id = p_customer for update;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if not app.has_store_access(v_acct.store_id) then raise exception 'FORBIDDEN'; end if;

  v_new := v_acct.balance - p_amount;
  update public.credit_accounts set balance = v_new where id = v_acct.id;
  insert into public.credit_transactions
    (credit_account_id, business_id, store_id, txn_type, amount, balance_after, performed_by, note)
  values (v_acct.id, v_acct.business_id, v_acct.store_id, 'PAYMENT', -p_amount, v_new, auth.uid(), p_note)
  returning id into v_txn;

  perform app.audit('credit.payment','credit_account',v_acct.id,v_acct.business_id,v_acct.store_id,
    jsonb_build_object('balance',v_acct.balance), jsonb_build_object('balance',v_new,'amount',p_amount));
  return v_txn;
end $$;

-- =====================================================================
-- set_credit_limit (manager+)
-- =====================================================================
create or replace function public.set_credit_limit(p_customer uuid, p_limit numeric)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_acct public.credit_accounts%rowtype;
begin
  if p_limit is null or p_limit < 0 then raise exception 'INVALID_LIMIT'; end if;
  select * into v_acct from public.credit_accounts where customer_id = p_customer;
  if not found then raise exception 'CREDIT_ACCOUNT_NOT_FOUND'; end if;
  if not app.has_store_role(v_acct.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  update public.credit_accounts set credit_limit = p_limit where id = v_acct.id;
  perform app.audit('credit.set_limit','credit_account',v_acct.id,v_acct.business_id,v_acct.store_id,
    jsonb_build_object('limit',v_acct.credit_limit), jsonb_build_object('limit',p_limit));
end $$;

-- =====================================================================
-- adjust_stock (manager+ authorized)
-- =====================================================================
create or replace function public.adjust_stock(
  p_store uuid, p_product uuid, p_new_qty numeric, p_reason text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_biz uuid; v_before numeric; v_delta numeric; v_adj uuid;
  v_reason app.adjustment_reason; v_mtype app.movement_type;
begin
  if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN'; end if;
  if p_new_qty is null or p_new_qty < 0 then raise exception 'INVALID_QUANTITY'; end if;
  v_biz := app.store_business(p_store);
  v_reason := upper(p_reason)::app.adjustment_reason;

  insert into public.stock (product_id, store_id, quantity) values (p_product, p_store, 0)
  on conflict (product_id, store_id) do nothing;
  select quantity into v_before from public.stock
    where product_id = p_product and store_id = p_store for update;

  v_delta := p_new_qty - v_before;
  if v_delta = 0 then raise exception 'NO_CHANGE'; end if;

  v_mtype := case v_reason
    when 'DAMAGED' then 'DAMAGED'::app.movement_type
    when 'EXPIRED' then 'EXPIRED'::app.movement_type
    else (case when v_delta > 0 then 'ADJUSTMENT_INCREASE' else 'ADJUSTMENT_DECREASE' end)::app.movement_type
  end;

  insert into public.stock_adjustments
    (business_id, store_id, product_id, reason, quantity_before, quantity_after, delta, note, performed_by)
  values (v_biz, p_store, p_product, v_reason, v_before, p_new_qty, v_delta, p_note, auth.uid())
  returning id into v_adj;

  perform app.apply_stock_delta(v_biz, p_store, p_product, v_delta, v_mtype,
    'Adjustment: '||p_reason||coalesce(' - '||p_note,''), 'stock_adjustment', v_adj, null);

  perform app.audit('stock.adjust','stock_adjustment',v_adj,v_biz,p_store,
    jsonb_build_object('qty',v_before), jsonb_build_object('qty',p_new_qty,'reason',p_reason));
  return v_adj;
end $$;

-- =====================================================================
-- Stock take: start (snapshot active products) and complete (apply variances)
-- =====================================================================
create or replace function public.start_stock_take(p_store uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_biz uuid; v_st uuid;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  v_biz := app.store_business(p_store);
  insert into public.stock_takes (business_id, store_id, note, started_by)
  values (v_biz, p_store, p_note, auth.uid()) returning id into v_st;

  insert into public.stock_take_items (stock_take_id, product_id, system_qty)
  select v_st, p.id, coalesce(s.quantity, 0)
  from public.products p
  left join public.stock s on s.product_id = p.id and s.store_id = p_store
  where p.store_id = p_store and p.is_active;

  perform app.audit('stock_take.start','stock_take',v_st,v_biz,p_store,null,null);
  return v_st;
end $$;

create or replace function public.complete_stock_take(p_stock_take uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_st public.stock_takes%rowtype; v_it record; v_before numeric; v_delta numeric; v_adj uuid;
begin
  select * into v_st from public.stock_takes where id = p_stock_take for update;
  if not found then raise exception 'STOCK_TAKE_NOT_FOUND'; end if;
  if not app.has_store_role(v_st.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
  if v_st.status = 'COMPLETED' then raise exception 'ALREADY_COMPLETED'; end if;

  for v_it in
    select * from public.stock_take_items
    where stock_take_id = p_stock_take and counted and counted_qty is not null
  loop
    insert into public.stock (product_id, store_id, quantity) values (v_it.product_id, v_st.store_id, 0)
    on conflict (product_id, store_id) do nothing;
    select quantity into v_before from public.stock
      where product_id = v_it.product_id and store_id = v_st.store_id for update;
    v_delta := v_it.counted_qty - v_before;
    if v_delta <> 0 then
      insert into public.stock_adjustments
        (business_id, store_id, product_id, reason, quantity_before, quantity_after, delta, note, performed_by)
      values (v_st.business_id, v_st.store_id, v_it.product_id, 'STOCK_COUNT_CORRECTION',
        v_before, v_it.counted_qty, v_delta, 'Stock take '||p_stock_take, auth.uid())
      returning id into v_adj;
      perform app.apply_stock_delta(v_st.business_id, v_st.store_id, v_it.product_id, v_delta,
        'STOCK_TAKE', 'Stock take correction', 'stock_take', p_stock_take, null);
    end if;
    update public.stock_take_items set variance = v_delta where id = v_it.id;
  end loop;

  update public.stock_takes
    set status = 'COMPLETED', approved_by = auth.uid(), completed_at = now()
    where id = p_stock_take;
  perform app.audit('stock_take.complete','stock_take',p_stock_take,v_st.business_id,v_st.store_id,null,null);
end $$;

-- =====================================================================
-- reconcile_stock: recompute quantities from the ledger and compare.
-- Used by tests and the "Check & Fix" flow. Read-only.
-- =====================================================================
create or replace function public.reconcile_stock(p_store uuid)
returns table(product_id uuid, stock_qty numeric, ledger_qty numeric, diff numeric)
language sql stable security definer set search_path = public, app as $$
  select s.product_id, s.quantity as stock_qty,
         coalesce(m.qty,0) as ledger_qty,
         s.quantity - coalesce(m.qty,0) as diff
  from public.stock s
  left join (
    select product_id, sum(quantity_delta) qty
    from public.stock_movements where store_id = p_store group by product_id
  ) m on m.product_id = s.product_id
  where s.store_id = p_store and app.has_store_access(p_store);
$$;

-- ---- grants ----
grant execute on function public.create_business(text,text) to authenticated;
grant execute on function public.create_product(uuid,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,boolean) to authenticated;
grant execute on function public.receive_stock(uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.complete_sale(uuid,text,uuid,jsonb,boolean,text) to authenticated;
grant execute on function public.record_credit_payment(uuid,numeric,text) to authenticated;
grant execute on function public.set_credit_limit(uuid,numeric) to authenticated;
grant execute on function public.adjust_stock(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.start_stock_take(uuid,text) to authenticated;
grant execute on function public.complete_stock_take(uuid) to authenticated;
grant execute on function public.reconcile_stock(uuid) to authenticated;
