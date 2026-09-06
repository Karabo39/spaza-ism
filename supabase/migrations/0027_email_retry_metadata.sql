-- Stable attachment metadata for provider idempotency across delayed retries.
create or replace function public.prepare_report_email(p_store uuid,p_request uuid,p_hash text,p_recipient text)
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
    return jsonb_build_object('id',previous.id,'sent',previous.status='SENT','created_at',previous.created_at);
  end if;
  if (select count(*) from public.report_email_jobs where user_id=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'EMAIL_RATE_LIMITED'; end if;
  insert into public.report_email_jobs(business_id,store_id,user_id,request_id,payload_hash,recipient)
    values(app.store_business(p_store),p_store,auth.uid(),p_request,p_hash,p_recipient) returning id into jid;
  perform app.audit('report.email_requested','report_email_jobs',jid,app.store_business(p_store),p_store,null,jsonb_build_object('recipient',p_recipient));
  return jsonb_build_object('id',jid,'sent',false,'created_at',now());
end $$;
