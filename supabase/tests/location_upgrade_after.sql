do $$
begin
  if (select count(*) from public.store_memberships) <> 1 then raise exception 'ASSERT assign only unambiguous single store'; end if;
  if exists(select 1 from public.stores where location_type <> 'store') then raise exception 'ASSERT existing stores remain stores'; end if;
  if exists((select * from public.stock_movements except select * from original_ledger)
    union all (select * from original_ledger except select * from public.stock_movements)) then raise exception 'ASSERT migration preserved complete ledger'; end if;
  if exists(select 1 from public.reconcile_stock('cccccccc-0000-0000-0000-000000000001') where diff<>0) then raise exception 'ASSERT migrated stock reconciles'; end if;
  perform set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}',true);
  set local role authenticated;
  if not app.has_store_access('cccccccc-0000-0000-0000-000000000001') then raise exception 'ASSERT existing single-store staff retain access'; end if;
  if app.has_store_access('cccccccc-0000-0000-0000-000000000002') then raise exception 'ASSERT ambiguous multi-store access requires owner assignment'; end if;
  reset role;
end $$;
