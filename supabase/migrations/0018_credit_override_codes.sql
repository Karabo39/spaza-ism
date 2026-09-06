-- Hashed personal approval codes and short-lived, single-use authorizations.
create table app.credit_override_codes (
  business_id uuid not null references public.businesses(id), user_id uuid not null references auth.users(id),
  code_hash text not null, updated_at timestamptz not null default now(), primary key(business_id,user_id)
);
create table app.credit_override_attempts (
  business_id uuid not null references public.businesses(id), user_id uuid not null references auth.users(id),
  attempts integer not null default 0, window_started timestamptz not null default now(), primary key(business_id,user_id)
);
create table app.credit_override_tokens (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
  store_id uuid not null references public.stores(id), customer_id uuid not null references public.customers(id),
  requested_by uuid not null references auth.users(id), authorized_by uuid not null references auth.users(id),
  max_amount numeric(14,2) not null check(max_amount>0), expires_at timestamptz not null default (now()+interval '2 minutes'), used_at timestamptz
);
alter table app.credit_override_codes enable row level security;
alter table app.credit_override_attempts enable row level security;
alter table app.credit_override_tokens enable row level security;
revoke all on app.credit_override_codes,app.credit_override_attempts,app.credit_override_tokens from public,anon,authenticated;
create function app.member_manages_location(p_user uuid,p_store uuid)
returns boolean language sql stable security definer set search_path=public,app as $$
  select exists(select 1 from public.memberships m join public.stores s on s.business_id=m.business_id
    where s.id=p_store and s.is_active and m.user_id=p_user and m.is_active and m.role in ('owner','manager')
      and (m.role='owner' or exists(select 1 from public.store_memberships sm where sm.membership_id=m.id and sm.store_id=s.id)));
$$;
create function public.set_credit_override_code(p_business uuid,p_code text)
returns void language plpgsql security definer set search_path=public,app,extensions as $$
begin
  if not app.has_business_role(p_business,'manager') then raise exception 'FORBIDDEN'; end if;
  if p_code is null or p_code !~ '^[0-9]{6,12}$' then raise exception 'INVALID_OVERRIDE_CODE_FORMAT'; end if;
  insert into app.credit_override_codes(business_id,user_id,code_hash) values(p_business,auth.uid(),crypt(p_code,gen_salt('bf',10)))
    on conflict(business_id,user_id) do update set code_hash=excluded.code_hash,updated_at=now();
  update app.credit_override_tokens set expires_at=now() where business_id=p_business and authorized_by=auth.uid() and used_at is null;
  perform app.audit('credit.override_code_set','membership',null,p_business,null,null,jsonb_build_object('user',auth.uid()));
end $$;
create function public.credit_override_authorizers(p_store uuid)
returns table(user_id uuid,name text) language plpgsql stable security definer set search_path=public,app as $$
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  return query select c.user_id,coalesce(p.full_name,'Manager') from app.credit_override_codes c
    join public.profiles p on p.id=c.user_id where c.business_id=app.store_business(p_store) and app.member_manages_location(c.user_id,p_store);
end $$;
create function public.authorize_credit_override(p_store uuid,p_customer uuid,p_manager uuid,p_code text,p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public,app,extensions as $$
declare biz uuid; state app.credit_override_attempts%rowtype; code text; token uuid;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  biz:=app.store_business(p_store);
  if not exists(select 1 from public.customers where id=p_customer and store_id=p_store and business_id=biz and is_active) then raise exception 'CUSTOMER_REQUIRED'; end if;
  if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or round(p_amount,2)<=0 then raise exception 'INVALID_AMOUNT'; end if;
  insert into app.credit_override_attempts(business_id,user_id) values(biz,auth.uid()) on conflict do nothing;
  select * into state from app.credit_override_attempts where business_id=biz and user_id=auth.uid() for update;
  if state.window_started < now()-interval '15 minutes' then
    update app.credit_override_attempts set attempts=0,window_started=now() where business_id=biz and user_id=auth.uid(); state.attempts:=0;
  end if;
  if state.attempts>=5 then return jsonb_build_object('ok',false,'error','OVERRIDE_RATE_LIMITED'); end if;
  update app.credit_override_attempts set attempts=attempts+1 where business_id=biz and user_id=auth.uid();
  select code_hash into code from app.credit_override_codes where business_id=biz and user_id=p_manager;
  if code is null or p_code is null or p_code !~ '^[0-9]{6,12}$' or not app.member_manages_location(p_manager,p_store) or crypt(p_code,code)<>code then
    perform app.audit('credit.override_denied','customer',p_customer,biz,p_store,null,jsonb_build_object('approver',p_manager));
    -- Return rather than raise: denial counters must commit, not roll back.
    return jsonb_build_object('ok',false,'error','INVALID_OVERRIDE_CODE');
  end if;
  update app.credit_override_attempts set attempts=0,window_started=now() where business_id=biz and user_id=auth.uid();
  insert into app.credit_override_tokens(business_id,store_id,customer_id,requested_by,authorized_by,max_amount)
    values(biz,p_store,p_customer,auth.uid(),p_manager,round(p_amount,2)) returning id into token;
  perform app.audit('credit.override_authorized','customer',p_customer,biz,p_store,null,jsonb_build_object('approver',p_manager,'maximum',round(p_amount,2)));
  return jsonb_build_object('ok',true,'token',token);
end $$;
create function app.consume_credit_override(p_token uuid,p_store uuid,p_customer uuid,p_amount numeric)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare t app.credit_override_tokens%rowtype;
begin
  select * into t from app.credit_override_tokens where id=p_token for update;
  if not found or t.used_at is not null or t.expires_at<=now() or t.requested_by<>auth.uid() or t.store_id<>p_store
    or t.customer_id<>p_customer or p_amount>t.max_amount or not app.member_manages_location(t.authorized_by,p_store)
    then raise exception 'OVERRIDE_NOT_AUTHORIZED'; end if;
  update app.credit_override_tokens set used_at=now() where id=t.id;
  return t.authorized_by;
end $$;
revoke execute on function app.member_manages_location(uuid,uuid),app.consume_credit_override(uuid,uuid,uuid,numeric) from public,anon,authenticated;
revoke execute on function public.set_credit_override_code(uuid,text),public.credit_override_authorizers(uuid),public.authorize_credit_override(uuid,uuid,uuid,text,numeric) from public,anon;
grant execute on function public.set_credit_override_code(uuid,text),public.credit_override_authorizers(uuid),public.authorize_credit_override(uuid,uuid,uuid,text,numeric) to authenticated;

-- Preserve the legacy call shape through defaulted parameters.
drop function public.complete_sale(uuid,text,uuid,jsonb,boolean,text,uuid,text);
create or replace function public.complete_sale(
  p_store uuid, p_sale_type text, p_customer uuid, p_items jsonb,
  p_override boolean default false, p_note text default null, p_request uuid default null, p_payment_reference text default null, p_override_token uuid default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  v_existing public.goods_out%rowtype; v_payload jsonb; v_biz uuid; v_go uuid; v_item jsonb; v_type app.sale_type;
  v_pid uuid; v_qty numeric; v_price numeric; v_line numeric; v_total numeric := 0;
  v_acct public.credit_accounts%rowtype;
  v_authorizer uuid; v_new_balance numeric; v_mtype app.movement_type; v_override boolean := false;
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
      if not coalesce(p_override,false) and p_override_token is null then
        raise exception 'CREDIT_LIMIT_EXCEEDED: balance % would exceed limit %',
          v_new_balance, v_acct.credit_limit using errcode = 'check_violation';
      end if;
      -- override requires manager+
      if not app.has_store_role(p_store,'manager') then
        v_authorizer:=app.consume_credit_override(p_override_token,p_store,p_customer,v_total);
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
          authorized_by = case when v_override then coalesce(v_authorizer,auth.uid()) else null end
      where id = v_go;
  end if;

  update public.goods_out set total_amount = v_total where id = v_go;

  perform app.audit('goods_out.complete','goods_out',v_go,v_biz,p_store,null,
    jsonb_build_object('sale_type',v_type,'total',v_total,'override',v_override));
  return v_go;
end $$;
revoke execute on function public.complete_sale(uuid,text,uuid,jsonb,boolean,text,uuid,text,uuid) from public,anon;
grant execute on function public.complete_sale(uuid,text,uuid,jsonb,boolean,text,uuid,text,uuid) to authenticated;
