-- =====================================================================
-- 0007_hardening.sql
-- Security-advisor remediations:
--  * Pin search_path on remaining helper functions.
--  * Move citext extension out of the public schema.
--  * Revoke EXECUTE on RPCs from PUBLIC/anon (Postgres grants EXECUTE to
--    PUBLIC by default). Only authenticated may call the workflow RPCs;
--    they still verify auth.uid() + role/store access internally.
-- =====================================================================

alter function app.touch_updated_at() set search_path = public, app;
alter function app.block_mutation() set search_path = public, app;
alter function app.role_rank(app.membership_role) set search_path = public, app;

-- Move citext to the standard extensions schema.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter extension citext set schema extensions;

-- Lock down SECURITY DEFINER functions: revoke the implicit PUBLIC grant.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_business','create_product','receive_stock',
        'complete_sale','record_credit_payment','set_credit_limit','adjust_stock',
        'start_stock_take','complete_stock_take','reconcile_stock','rls_auto_enable')
  loop
    execute format('revoke execute on function %s from public;', r.sig);
    execute format('revoke execute on function %s from anon;', r.sig);
  end loop;
end $$;

-- Re-grant only the workflow RPCs to authenticated (rls_auto_enable stays
-- callable by nobody but the event-trigger machinery).
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
