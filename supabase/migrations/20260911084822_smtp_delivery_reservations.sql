-- SMTP has no provider-side idempotency. Reserve durably before opening a
-- connection; uncertain attempts require operator review, never auto-retry.
create table app.smtp_deliveries (
 delivery_key text primary key,
 token uuid not null default gen_random_uuid(),
 provider text,
 created_at timestamptz not null default now(),
 accepted_at timestamptz
);
alter table app.smtp_deliveries enable row level security;
revoke all on app.smtp_deliveries from public, anon, authenticated;

create or replace function public.smtp_delivery(p_key text, p_token uuid default null, p_provider text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item app.smtp_deliveries%rowtype; job_id uuid; inserted boolean;
begin
 if p_key is null or length(p_key)>160 then raise exception 'INVALID_DELIVERY'; end if;
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','') <> 'service_role' then
   if auth.uid() is null or p_key !~ '^(document|report)-[0-9a-f-]{36}$' then raise exception 'FORBIDDEN'; end if;
   job_id := substring(p_key from '[0-9a-f-]{36}$')::uuid;
   if not exists(select 1 from public.report_email_jobs j where j.id=job_id and j.user_id=auth.uid() and app.has_store_access(j.store_id)) then raise exception 'FORBIDDEN'; end if;
 else
   if p_key !~ '^(notification-[0-9a-f-]{36}|employee-invitation-[0-9a-f-]{36}-[0-9]+)$' then raise exception 'INVALID_DELIVERY'; end if;
 end if;
 if p_provider is not null then
   if p_token is null or length(p_provider)>254 or p_provider='' then raise exception 'INVALID_DELIVERY'; end if;
   update app.smtp_deliveries set provider=p_provider,accepted_at=now()
    where delivery_key=p_key and token=p_token and (provider is null or provider=p_provider)
    returning * into item;
   if not found then raise exception 'INVALID_RESERVATION'; end if;
   return jsonb_build_object('provider',item.provider);
 end if;
 insert into app.smtp_deliveries(delivery_key) values(p_key) on conflict do nothing returning * into item;
 inserted := found;
 if inserted then return jsonb_build_object('token',item.token); end if;
 select * into item from app.smtp_deliveries where delivery_key=p_key;
 if item.provider is not null then return jsonb_build_object('provider',item.provider); end if;
 return '{}'::jsonb;
end $$;
revoke all on function public.smtp_delivery(text,uuid,text) from public,anon;
grant execute on function public.smtp_delivery(text,uuid,text) to authenticated,service_role;
