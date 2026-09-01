-- =====================================================================
-- 0008_lock_event_trigger_fn.sql
-- rls_auto_enable() is a Supabase-provided event-trigger function (auto-
-- enables RLS on new public tables). It should never be called directly
-- via the API; revoke all EXECUTE. The event-trigger machinery still runs
-- it (event triggers ignore EXECUTE grants).
-- =====================================================================
revoke execute on function public.rls_auto_enable() from authenticated, anon, public;
