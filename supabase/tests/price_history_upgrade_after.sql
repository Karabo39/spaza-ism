do $$ begin
  if not exists(select 1 from public.product_price_history h join price_history_upgrade_fixture f on f.history_id=h.id where h.old_cost=5 and h.new_cost=7 and h.old_selling=10 and h.new_selling=12) then raise exception 'ASSERT old price history preserved';end if;
  if (select count(*) from public.product_price_history h join price_history_upgrade_fixture f on f.product_id=h.product_id)<>2 then raise exception 'ASSERT historical change plus opening snapshot';end if;
end $$;
