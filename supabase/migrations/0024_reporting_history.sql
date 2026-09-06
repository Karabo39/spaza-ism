create table public.product_price_history (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), store_id uuid not null references public.stores(id),
  product_id uuid not null references public.products(id), product_name text not null,
  old_cost numeric(14,2), new_cost numeric(14,2) not null, old_selling numeric(14,2), new_selling numeric(14,2) not null,
  reason text not null, performed_by uuid references auth.users(id), created_at timestamptz not null default now()
);
alter table public.product_price_history enable row level security;
revoke all on public.product_price_history from public,anon,authenticated;
grant select on public.product_price_history to authenticated;
create policy price_history_read on public.product_price_history for select to authenticated using(app.has_store_access(store_id));
create index price_history_location on public.product_price_history(store_id,created_at desc);
create index price_history_product on public.product_price_history(product_id,created_at desc);
create trigger price_history_append_only before update or delete on public.product_price_history for each row execute function app.block_mutation();
insert into public.product_price_history(business_id,store_id,product_id,product_name,new_cost,new_selling,reason)
  select business_id,store_id,id,name,cost_price,selling_price,'Opening snapshot at price-history rollout' from public.products;
create function app.capture_product_price()
returns trigger language plpgsql security definer set search_path=public,app as $$
begin
  if tg_op='INSERT' or new.cost_price is distinct from old.cost_price or new.selling_price is distinct from old.selling_price then
    insert into public.product_price_history(business_id,store_id,product_id,product_name,old_cost,new_cost,old_selling,new_selling,reason,performed_by)
      values(new.business_id,new.store_id,new.id,new.name,case when tg_op='UPDATE' then old.cost_price end,new.cost_price,case when tg_op='UPDATE' then old.selling_price end,new.selling_price,case when tg_op='INSERT' then 'Product created' else 'Price changed' end,auth.uid());
  end if;
  return new;
end $$;
create trigger products_price_history after insert or update of cost_price,selling_price on public.products for each row execute function app.capture_product_price();

-- Store the actual cost from now on. Historical null costs remain untouched.
create function app.snapshot_movement_cost()
returns trigger language plpgsql security definer set search_path=public,app as $$
begin
  if new.unit_cost is null and new.reference_table='goods_returns' then
    select coalesce(ii.cost_price,sm.unit_cost) into new.unit_cost from public.goods_return_items ri
      left join public.sales_invoice_items ii on ii.id=ri.invoice_item_id
      left join public.goods_out_items si on si.id=ri.sale_item_id
      left join lateral(select unit_cost from public.stock_movements where reference_table='goods_out' and reference_id=si.goods_out_id and product_id=ri.product_id order by created_at limit 1) sm on true
      where ri.return_id=new.reference_id and ri.product_id=new.product_id limit 1;
  end if;
  if new.unit_cost is null then select cost_price into new.unit_cost from public.products where id=new.product_id; end if;
  return new;
end $$;
create trigger stock_movement_cost before insert on public.stock_movements for each row execute function app.snapshot_movement_cost();

create or replace function public.product_sales_summary(p_store uuid,p_from date default null,p_to date default null)
returns table(product_id uuid,name text,sold_qty numeric,sold_value numeric,current_qty numeric)
language sql stable security definer set search_path=public,app as $$
  select p.id,p.name,coalesce(s.q,0),coalesce(s.v,0),coalesce(st.quantity,0) from public.products p
  left join public.stock st on st.product_id=p.id and st.store_id=p_store
  left join (
    select x.product_id,sum(x.quantity) q,sum(x.value) v from (
      select li.product_id,li.quantity,li.line_total value,(g.created_at at time zone 'Africa/Johannesburg')::date occurred from public.goods_out_items li join public.goods_out g on g.id=li.goods_out_id where g.store_id=p_store
      union all select li.product_id,li.quantity,round(li.net_total/(1+i.tax_percent/100),2),(i.goods_issued_at at time zone 'Africa/Johannesburg')::date from public.sales_invoice_items li join public.sales_invoices i on i.id=li.invoice_id where i.store_id=p_store and i.goods_issued_at is not null
    ) x where (p_from is null or occurred>=p_from) and (p_to is null or occurred<=p_to) group by x.product_id
  ) s on s.product_id=p.id where p.store_id=p_store and p.is_active and app.has_store_access(p_store);
$$;

create function app.profit_data(p_store uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public,app as $$
declare revenue numeric; returns numeric; costs numeric; estimated integer;
begin
  if p_from is null or p_to is null or p_from>p_to then raise exception 'INVALID_DATE_RANGE'; end if;
  select coalesce(sum(value),0) into revenue from (
    select total_amount value from public.goods_out where store_id=p_store and (created_at at time zone 'Africa/Johannesburg')::date between p_from and p_to
    union all select subtotal-discount from public.sales_invoices where store_id=p_store and (goods_issued_at at time zone 'Africa/Johannesburg')::date between p_from and p_to
  ) revenue_rows;
  select coalesce(sum(round(r.amount/(1+coalesce(i.tax_percent,0)/100),2)),0) into returns from public.goods_returns r left join public.sales_invoices i on i.id=r.invoice_id
    where r.store_id=p_store and r.status='APPROVED' and (r.processed_at at time zone 'Africa/Johannesburg')::date between p_from and p_to;
  select coalesce(-sum(m.quantity_delta*coalesce(m.unit_cost,p.cost_price)),0),count(*) filter(where m.unit_cost is null) into costs,estimated
    from public.stock_movements m join public.products p on p.id=m.product_id where m.store_id=p_store and m.movement_type in ('SALE_CASH','SALE_CARD','SALE_CREDIT','RETURN_IN')
      and (m.created_at at time zone 'Africa/Johannesburg')::date between p_from and p_to;
  return jsonb_build_object('sales',round(revenue,2),'returns',round(returns,2),'net_sales',round(revenue-returns,2),'cost_of_goods',round(costs,2),'gross_profit',round(revenue-returns-costs,2),'estimated_cost_movements',estimated);
end $$;
revoke execute on function app.profit_data(uuid,date,date) from public,anon,authenticated;
create function public.profit_summary(p_store uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public,app as $$
begin
  if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN'; end if;
  return app.profit_data(p_store,p_from,p_to);
end $$;
revoke execute on function public.profit_summary(uuid,date,date) from public,anon;
grant execute on function public.profit_summary(uuid,date,date) to authenticated;
