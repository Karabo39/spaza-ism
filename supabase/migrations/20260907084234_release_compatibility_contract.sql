-- Anonymous-safe feature probe: no business data, keys, or migration history.
create function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
    'brd_v102', to_regprocedure('public.invoice_summary(uuid)') is not null
      and exists(select 1 from pg_attribute where attrelid=to_regclass('public.stores') and attname='location_type' and not attisdropped),
    'module_access_v1', to_regprocedure('public.my_module_access(uuid)') is not null
      and to_regprocedure('public.set_store_module_access(uuid,uuid,jsonb,bigint)') is not null,
    'cash_up_v1', to_regprocedure('public.cash_up_summary(uuid,date)') is not null
      and to_regprocedure('public.submit_cash_up(uuid,numeric,jsonb,text,text,uuid)') is not null
  ));
$$;
revoke all on function public.app_schema_status() from public;
grant execute on function public.app_schema_status() to anon,authenticated,service_role;
