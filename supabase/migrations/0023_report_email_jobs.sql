create table public.report_email_jobs (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), store_id uuid not null references public.stores(id),
  user_id uuid not null references auth.users(id), request_id uuid not null, payload_hash text not null,
  recipient text not null, status text not null default 'PENDING' check(status in ('PENDING','SENT')),
  created_at timestamptz not null default now(), sent_at timestamptz, provider_id text, unique(user_id,request_id)
);
alter table public.report_email_jobs enable row level security;
revoke all on public.report_email_jobs from public,anon,authenticated;
grant select on public.report_email_jobs to authenticated;
create policy report_jobs_read on public.report_email_jobs for select to authenticated using(user_id=auth.uid() and app.has_store_access(store_id));
create index report_email_jobs_rate on public.report_email_jobs(user_id,created_at desc);
create function public.prepare_report_email(p_store uuid,p_request uuid,p_hash text,p_recipient text)
returns jsonb language plpgsql security definer set search_path=public,app as $$
declare previous public.report_email_jobs%rowtype; jid uuid;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  if p_request is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_recipient is null or length(p_recipient)>254 or p_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_EMAIL_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended('report-email:'||auth.uid()::text,0));
  select * into previous from public.report_email_jobs where user_id=auth.uid() and request_id=p_request;
  if found then
    if previous.payload_hash<>p_hash or previous.recipient<>p_recipient or previous.store_id<>p_store then raise exception 'REQUEST_CONFLICT'; end if;
    if previous.status='PENDING' and previous.created_at<now()-interval '23 hours' then raise exception 'EMAIL_RETRY_EXPIRED'; end if;
    return jsonb_build_object('id',previous.id,'sent',previous.status='SENT');
  end if;
  if (select count(*) from public.report_email_jobs where user_id=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'EMAIL_RATE_LIMITED'; end if;
  insert into public.report_email_jobs(business_id,store_id,user_id,request_id,payload_hash,recipient)
    values(app.store_business(p_store),p_store,auth.uid(),p_request,p_hash,p_recipient) returning id into jid;
  perform app.audit('report.email_requested','report_email_jobs',jid,app.store_business(p_store),p_store,null,jsonb_build_object('recipient',p_recipient));
  return jsonb_build_object('id',jid,'sent',false);
end $$;
create function public.complete_report_email(p_job uuid,p_provider text)
returns void language plpgsql security definer set search_path=public,app as $$
declare j public.report_email_jobs%rowtype;
begin
  select * into j from public.report_email_jobs where id=p_job for update;
  if not found or j.user_id<>auth.uid() or not app.has_store_access(j.store_id) then raise exception 'FORBIDDEN'; end if;
  update public.report_email_jobs set status='SENT',sent_at=now(),provider_id=p_provider where id=j.id and status='PENDING';
  perform app.audit('report.email_sent','report_email_jobs',j.id,j.business_id,j.store_id,null,null);
end $$;
revoke execute on function public.prepare_report_email(uuid,uuid,text,text),public.complete_report_email(uuid,text) from public,anon;
grant execute on function public.prepare_report_email(uuid,uuid,text,text),public.complete_report_email(uuid,text) to authenticated;
