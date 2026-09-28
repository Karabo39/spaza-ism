-- Legacy integrations retain their manager-created customer defaults. Employee
-- creation is always cash/card-only, even when a direct request supplies true.
do $$ declare definition text;begin
 select pg_get_functiondef('app_private.guard_customer_profile()'::regprocedure) into definition;
 definition:=replace(definition,'if tg_op=''UPDATE'' and new.credit_enabled',
 'if tg_op=''INSERT'' and auth.uid() is not null and not app.has_store_role(new.store_id,''manager'') then new.credit_enabled:=false;end if;
 if tg_op=''UPDATE'' and new.credit_enabled');
 if definition not like '%new.credit_enabled:=false%' then raise exception 'Customer guard pattern changed';end if;
 execute definition;
end $$;
