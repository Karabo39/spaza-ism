do $$
declare p uuid; linked uuid;
begin
 select id into p from public.products where name='Upgrade main';select id into linked from public.products where name='Legacy cases';
 if (select bulk_parent_id from public.products where id=linked)<>p or not (select bulk_enabled from public.products where id=p) then raise exception 'ASSERT legacy linked';end if;
 if (select quantity from public.stock where product_id=linked)<>3 then raise exception 'ASSERT legacy quantity preserved';end if;
 if not exists(select 1 from public.stock_movements where product_id=linked and stock_type is null and quantity_after=3) then raise exception 'ASSERT legacy movement preserved';end if;
 if exists(select 1 from public.cash_up_submissions where counted<>50 or expected<>50 or variance<>0) then raise exception 'ASSERT historic cash changed';end if;
end $$;
