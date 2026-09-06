-- Preserve the pre-v1.02 price-change ledger in the new report, including
-- unknown legacy values. Retain the old table/trigger for older app versions.
alter table public.product_price_history alter column new_cost drop not null;
alter table public.product_price_history alter column new_selling drop not null;
insert into public.product_price_history(id,business_id,store_id,product_id,product_name,old_cost,new_cost,old_selling,new_selling,reason,performed_by,created_at)
select h.id,p.business_id,h.store_id,h.product_id,p.name,h.old_cost,h.new_cost,h.old_selling,h.new_selling,
  'Historical change: '||coalesce(h.source,'legacy'),h.changed_by,h.changed_at
from public.price_history h join public.products p on p.id=h.product_id
where not exists(select 1 from public.product_price_history n where n.product_id=h.product_id and n.created_at=h.changed_at
  and n.old_cost is not distinct from h.old_cost and n.new_cost is not distinct from h.new_cost
  and n.old_selling is not distinct from h.old_selling and n.new_selling is not distinct from h.new_selling)
on conflict(id) do nothing;
