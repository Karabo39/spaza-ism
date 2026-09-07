-- Cash-up snapshots do not rewrite the sales, credit or refund ledgers.
create table public.cash_ups (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
 store_id uuid not null references public.stores(id), business_date date not null,
 opening_float numeric(14,2) not null check(opening_float>=0 and opening_float::text<>'NaN'),
 status text not null default 'OPEN' check(status in ('OPEN','SUBMITTED','APPROVED')),
 version bigint not null default 1, latest_submission uuid,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(store_id,business_date)
);
create table public.cash_up_submissions (
 id uuid primary key default gen_random_uuid(), cash_up_id uuid not null references public.cash_ups(id),
 revision bigint not null, counted numeric(14,2) not null check(counted>=0 and counted::text<>'NaN'),
 expected numeric(14,2) not null, variance numeric(14,2) generated always as(counted-expected) stored,
 denominations jsonb not null, note text, sources jsonb not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 request_id uuid not null, request_payload jsonb not null,
 unique(cash_up_id,revision), unique(cash_up_id,request_id)
);
alter table public.cash_ups add constraint cash_up_latest_submission foreign key(latest_submission) references public.cash_up_submissions(id);
create table public.cash_up_reviews (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.cash_up_submissions(id),
 action text not null check(action in ('APPROVE','REOPEN')), note text,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(submission_id,action)
);
create table public.cash_drawer_movements (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 business_date date not null, kind text not null check(kind in ('ADD','REMOVE')),
 amount numeric(14,2) not null check(amount>0 and amount::text<>'NaN'), reason text not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 request_id uuid not null, request_payload jsonb not null, unique(store_id,request_id)
);
create index cash_drawer_day on public.cash_drawer_movements(store_id,business_date);
-- Historical standalone credit payments had no tender. Leave them unclassified
-- until a manager checks their evidence; do not silently assume they were cash.
create table public.credit_payment_methods (
 transaction_id uuid primary key references public.credit_transactions(id),
 store_id uuid not null references public.stores(id), method text not null check(method in ('CASH','CARD_EFT')),
 classified_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 request_id uuid, request_payload jsonb, unique(store_id,request_id)
);
create index cash_credit_sources on public.credit_transactions(store_id,created_at) where txn_type='PAYMENT' and reference_table is null;
create index cash_invoice_sources on public.invoice_entries(store_id,created_at) where kind='PAYMENT' and method='CASH';
create index cash_refund_sources on public.customer_refunds(store_id,created_at) where method='CASH';

do $f$ declare t text; begin
 foreach t in array array['cash_ups','cash_up_submissions','cash_up_reviews','cash_drawer_movements','credit_payment_methods'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['cash_up_submissions','cash_up_reviews','cash_drawer_movements','credit_payment_methods'] loop
  execute format('create trigger immutable_cash_record before update or delete on public.%I for each row execute function app.block_mutation()',t);
 end loop;
end $f$;
create policy cash_up_read on public.cash_ups for select to authenticated using(app.has_module(store_id,'cash_up'));
create policy cash_submission_read on public.cash_up_submissions for select to authenticated using(exists(select 1 from public.cash_ups c where c.id=cash_up_id));
create policy cash_review_read on public.cash_up_reviews for select to authenticated using(exists(select 1 from public.cash_up_submissions s where s.id=submission_id));
create policy drawer_read on public.cash_drawer_movements for select to authenticated using(app.has_module(store_id,'cash_up'));
create policy payment_method_read on public.credit_payment_methods for select to authenticated using(app.has_any_module(store_id,array['cash_up','credit']));

create function app.cash_day_lock(p_store uuid,p_day date) returns void
language sql volatile security definer set search_path=public,app as $f$
 select pg_advisory_xact_lock(hashtextextended('cash_up:'||p_store::text||p_day::text,0));
$f$;
create function app.lock_cash_source() returns trigger
language plpgsql security definer set search_path=public,app as $f$
begin
 perform app.cash_day_lock(new.store_id,(new.created_at at time zone 'Africa/Johannesburg')::date);
 return new;
end $f$;
-- Hold the same lock until each receipt/refund transaction commits. Header
-- totals updated later in that transaction are included before counts proceed.
create trigger lock_cash_source before insert on public.goods_out for each row when(new.sale_type='CASH') execute function app.lock_cash_source();
create trigger lock_cash_source before insert on public.invoice_entries for each row when(new.kind='PAYMENT' and new.method='CASH') execute function app.lock_cash_source();
create trigger lock_cash_source before insert on public.credit_transactions for each row when(new.txn_type='PAYMENT' and new.reference_table is null) execute function app.lock_cash_source();
create trigger lock_cash_source before insert on public.customer_refunds for each row when(new.method='CASH') execute function app.lock_cash_source();

create function app.cash_sources(p_store uuid,p_day date) returns jsonb
language sql stable security definer set search_path=public,app as $f$
 with bounds as(select p_day::timestamp at time zone 'Africa/Johannesburg' lo,(p_day+1)::timestamp at time zone 'Africa/Johannesburg' hi),
 sources as (
  select 'sales' kind,g.id,g.total_amount amount from public.goods_out g,bounds where g.store_id=p_store and g.sale_type='CASH' and g.created_at>=lo and g.created_at<hi
  union all select 'invoices',i.id,i.amount from public.invoice_entries i,bounds where i.store_id=p_store and i.kind='PAYMENT' and i.method='CASH' and i.created_at>=lo and i.created_at<hi
  union all select case when m.method is null then 'unclassified' else 'credit' end,c.id,-c.amount from public.credit_transactions c left join public.credit_payment_methods m on m.transaction_id=c.id,bounds
   where c.store_id=p_store and c.txn_type='PAYMENT' and c.reference_table is null and c.created_at>=lo and c.created_at<hi and (m.method is null or m.method='CASH')
  union all select 'refunds',r.id,-r.amount from public.customer_refunds r,bounds where r.store_id=p_store and r.method='CASH' and r.created_at>=lo and r.created_at<hi
  union all select case when kind='ADD' then 'added' else 'removed' end,id,case when kind='ADD' then amount else -amount end from public.cash_drawer_movements where store_id=p_store and business_date=p_day
 ) select jsonb_build_object(
  'sales',coalesce(sum(amount) filter(where kind='sales'),0),
  'invoices',coalesce(sum(amount) filter(where kind='invoices'),0),
  'credit',coalesce(sum(amount) filter(where kind='credit'),0),
  'refunds',-coalesce(sum(amount) filter(where kind='refunds'),0),
  'added',coalesce(sum(amount) filter(where kind='added'),0),
  'removed',-coalesce(sum(amount) filter(where kind='removed'),0),
  'net',coalesce(sum(amount) filter(where kind<>'unclassified'),0),
  'unclassified',coalesce(jsonb_agg(jsonb_build_object('id',id,'amount',amount,
   'customer_name',(select u.name from public.credit_transactions t join public.customers u on u.id=(select customer_id from public.credit_accounts where id=t.credit_account_id) where t.id=sources.id),
   'created_at',(select created_at from public.credit_transactions where id=sources.id))) filter(where kind='unclassified'),'[]'::jsonb),
  'fingerprint',md5(coalesce(string_agg(kind||':'||id::text||':'||amount::text,',' order by kind,id),''))
 ) from sources;
$f$;

create function public.cash_up_summary(p_store uuid,p_day date) returns jsonb
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype; source jsonb; history jsonb;
begin
 perform app.require_module(p_store,array['cash_up']);
 if p_day is null then raise exception 'INVALID_DATE'; end if;
 select * into c from public.cash_ups where store_id=p_store and business_date=p_day;
 source:=app.cash_sources(p_store,p_day);
 select coalesce(jsonb_agg(to_jsonb(s)-'request_payload'-'request_id' || jsonb_build_object('created_by_name',coalesce(p.full_name,'Team member'),
  'reviews',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('created_by_name',coalesce(rp.full_name,'Manager')) order by r.created_at),'[]'::jsonb) from public.cash_up_reviews r left join public.profiles rp on rp.id=r.created_by where r.submission_id=s.id)) order by s.revision desc),'[]'::jsonb)
 into history from public.cash_up_submissions s left join public.profiles p on p.id=s.created_by where s.cash_up_id=c.id;
 return jsonb_build_object('session',case when c.id is null then null else to_jsonb(c) end,'sources',source,'history',history,
  'expected',coalesce(c.opening_float,0)+(source->>'net')::numeric,
  'count_token',md5((source->>'fingerprint')||':'||c.opening_float::text||':'||c.version::text),
  'changed_since_count',c.latest_submission is not null and source->>'fingerprint' is distinct from (select sources->>'fingerprint' from public.cash_up_submissions where id=c.latest_submission),
  'movements',(select coalesce(jsonb_agg(to_jsonb(d)-'request_payload'-'request_id' order by created_at desc),'[]'::jsonb) from public.cash_drawer_movements d where store_id=p_store and business_date=p_day));
end $f$;

create function public.open_cash_up(p_store uuid,p_day date,p_float numeric) returns uuid
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype;
begin
 perform app.require_module(p_store,array['cash_up']);
 if not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
 if p_day is null or p_day>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'INVALID_DATE'; end if;
 if p_float is null or p_float::text in ('NaN','Infinity','-Infinity') or p_float<0 or p_float<>round(p_float,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 perform app.cash_day_lock(p_store,p_day);
 select * into c from public.cash_ups where store_id=p_store and business_date=p_day;
 if found then if c.opening_float<>p_float then raise exception 'CASH_UP_ALREADY_OPEN'; end if; return c.id; end if;
 insert into public.cash_ups(business_id,store_id,business_date,opening_float,created_by) values(app.store_business(p_store),p_store,p_day,p_float,auth.uid()) returning * into c;
 perform app.audit('cash_up.open','cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('date',p_day,'opening_float',p_float));
 return c.id;
end $f$;

create function public.submit_cash_up(p_cash_up uuid,p_counted numeric,p_denominations jsonb,p_fingerprint text,p_note text,p_request uuid) returns uuid
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype; source jsonb; payload jsonb; prior public.cash_up_submissions%rowtype; sid uuid; total numeric;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 payload:=jsonb_build_object('user',auth.uid(),'counted',p_counted,'denominations',p_denominations,'fingerprint',p_fingerprint,'note',p_note);
 select * into prior from public.cash_up_submissions where cash_up_id=c.id and request_id=p_request;
 if found then if prior.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return prior.id; end if;
 if c.status<>'OPEN' then raise exception 'CASH_UP_NOT_OPEN'; end if;
 if p_counted is null or p_counted::text in ('NaN','Infinity','-Infinity') or p_counted<0 or p_counted<>round(p_counted,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 if p_denominations is null or jsonb_typeof(p_denominations)<>'object' then raise exception 'INVALID_DENOMINATIONS'; end if;
 if exists(select 1 from jsonb_each(p_denominations) e where key not in ('200','100','50','20','10','5','2','1','0.5','0.2','0.1','0.05','0.02','0.01') or jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]{1,7}$') then raise exception 'INVALID_DENOMINATIONS'; end if;
 if p_denominations<>'{}'::jsonb then
  select coalesce(sum(key::numeric*value::numeric),0) into total from jsonb_each_text(p_denominations);
  if total<>p_counted then raise exception 'CASH_COUNT_MISMATCH'; end if;
  if (select currency from public.businesses where id=c.business_id)<>'ZAR' then raise exception 'DENOMINATIONS_REQUIRE_ZAR'; end if;
 end if;
 source:=app.cash_sources(c.store_id,c.business_date);
 if jsonb_array_length(source->'unclassified')>0 then raise exception 'UNCLASSIFIED_PAYMENTS'; end if;
 if p_fingerprint is distinct from md5((source->>'fingerprint')||':'||c.opening_float::text||':'||c.version::text) then raise exception 'CASH_ACTIVITY_CHANGED'; end if;
 if p_counted<>c.opening_float+(source->>'net')::numeric and nullif(btrim(p_note),'') is null then raise exception 'VARIANCE_NOTE_REQUIRED'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'NOTE_TOO_LONG'; end if;
 insert into public.cash_up_submissions(cash_up_id,revision,counted,expected,denominations,note,sources,created_by,request_id,request_payload)
 values(c.id,c.version,p_counted,c.opening_float+(source->>'net')::numeric,p_denominations,p_note,source||jsonb_build_object('opening_float',c.opening_float),auth.uid(),p_request,payload) returning id into sid;
 update public.cash_ups set status='SUBMITTED',latest_submission=sid,version=version+1 where id=c.id;
 perform app.audit('cash_up.submit','cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('submission',sid,'counted',p_counted,'expected',c.opening_float+(source->>'net')::numeric));
 return sid;
end $f$;

create function public.review_cash_up(p_cash_up uuid,p_submission uuid,p_action text,p_note text) returns void
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype; s public.cash_up_submissions%rowtype; source jsonb;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 if not app.has_store_role(c.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if p_submission is null or p_submission is distinct from c.latest_submission then raise exception 'CASH_UP_CHANGED'; end if;
 select * into s from public.cash_up_submissions where id=p_submission;
 if p_action='APPROVE' then
  if c.status='APPROVED' then return; end if;
  if c.status<>'SUBMITTED' then raise exception 'CASH_UP_CHANGED'; end if;
  source:=app.cash_sources(c.store_id,c.business_date);
  if source->>'fingerprint' is distinct from s.sources->>'fingerprint' then raise exception 'CASH_ACTIVITY_CHANGED'; end if;
  if s.variance<>0 and nullif(btrim(p_note),'') is null then raise exception 'VARIANCE_NOTE_REQUIRED'; end if;
 elsif p_action='REOPEN' then
  if c.status='OPEN' then return; end if;
  if nullif(btrim(p_note),'') is null then raise exception 'REASON_REQUIRED'; end if;
 else raise exception 'INVALID_ACTION'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'NOTE_TOO_LONG'; end if;
 insert into public.cash_up_reviews(submission_id,action,note,created_by) values(s.id,p_action,p_note,auth.uid());
 update public.cash_ups set status=case when p_action='APPROVE' then 'APPROVED' else 'OPEN' end,version=version+1 where id=c.id;
 perform app.audit('cash_up.'||lower(p_action),'cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('submission',s.id,'note',p_note));
end $f$;

create function public.correct_cash_up_float(p_cash_up uuid,p_float numeric,p_version bigint,p_reason text) returns void
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 if not app.has_store_role(c.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if c.status<>'OPEN' or p_version is distinct from c.version then raise exception 'CASH_UP_CHANGED'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'REASON_REQUIRED'; end if;
 if p_float is null or p_float::text in ('NaN','Infinity','-Infinity') or p_float<0 or p_float<>round(p_float,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 update public.cash_ups set opening_float=p_float,version=version+1 where id=c.id;
 perform app.audit('cash_up.float','cash_up',c.id,c.business_id,c.store_id,jsonb_build_object('opening_float',c.opening_float),jsonb_build_object('opening_float',p_float,'reason',p_reason));
end $f$;

create function public.record_cash_movement(p_store uuid,p_day date,p_kind text,p_amount numeric,p_reason text,p_request uuid) returns uuid
language plpgsql security definer set search_path=public,app as $f$
declare previous public.cash_drawer_movements%rowtype; payload jsonb; mid uuid;
begin
 perform app.require_module(p_store,array['cash_up']);
 if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN'; end if;
 if p_day is null or p_day>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'INVALID_DATE'; end if;
 if not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 if p_kind is null or p_kind not in ('ADD','REMOVE') then raise exception 'INVALID_ACTION'; end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'REASON_REQUIRED'; end if;
 perform app.cash_day_lock(p_store,p_day);
 payload:=jsonb_build_object('user',auth.uid(),'day',p_day,'kind',p_kind,'amount',p_amount,'reason',p_reason);
 select * into previous from public.cash_drawer_movements where store_id=p_store and request_id=p_request;
 if found then if previous.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return previous.id; end if;
 insert into public.cash_drawer_movements(store_id,business_date,kind,amount,reason,created_by,request_id,request_payload) values(p_store,p_day,p_kind,p_amount,p_reason,auth.uid(),p_request,payload) returning id into mid;
 perform app.audit('cash_up.movement','cash_drawer_movement',mid,app.store_business(p_store),p_store,null,payload);
 return mid;
end $f$;

create function public.record_credit_payment_tender(p_customer uuid,p_amount numeric,p_method text,p_request uuid,p_note text default null) returns uuid
language plpgsql security definer set search_path=public,app as $f$
declare loc uuid; previous public.credit_payment_methods%rowtype; tid uuid; payload jsonb;
begin
 select store_id into loc from public.customers where id=p_customer;
 perform app.require_module(loc,array['credit']);
 if p_method is null or p_method not in ('CASH','CARD_EFT') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('credit_payment:'||loc::text||p_request::text,0));
 payload:=jsonb_build_object('user',auth.uid(),'customer',p_customer,'amount',p_amount,'method',p_method,'note',p_note);
 select * into previous from public.credit_payment_methods where store_id=loc and request_id=p_request;
 if found then if previous.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return previous.transaction_id; end if;
 tid:=app_private.record_credit_payment(p_customer,p_amount,p_note);
 insert into public.credit_payment_methods(transaction_id,store_id,method,classified_by,request_id,request_payload) values(tid,loc,p_method,auth.uid(),p_request,payload);
 perform app.audit('credit.payment_method','credit_transaction',tid,app.store_business(loc),loc,null,jsonb_build_object('method',p_method));
 return tid;
end $f$;

create function public.classify_credit_payment(p_transaction uuid,p_method text) returns void
language plpgsql security definer set search_path=public,app as $f$
declare t public.credit_transactions%rowtype; previous text;
begin
 select * into t from public.credit_transactions where id=p_transaction and txn_type='PAYMENT' and reference_table is null;
 perform app.require_module(t.store_id,array['cash_up']);
 if not app.has_store_role(t.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
 if p_method is null or p_method not in ('CASH','CARD_EFT') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
 perform app.cash_day_lock(t.store_id,(t.created_at at time zone 'Africa/Johannesburg')::date);
 select method into previous from public.credit_payment_methods where transaction_id=t.id;
 if found then if previous<>p_method then raise exception 'PAYMENT_ALREADY_CLASSIFIED'; end if; return; end if;
 insert into public.credit_payment_methods(transaction_id,store_id,method,classified_by) values(t.id,t.store_id,p_method,auth.uid());
 perform app.audit('credit.classify_payment','credit_transaction',t.id,t.business_id,t.store_id,null,jsonb_build_object('method',p_method));
end $f$;

revoke all on function app.cash_day_lock(uuid,date),app.lock_cash_source(),app.cash_sources(uuid,date) from public,anon,authenticated;
do $f$ declare signature regprocedure; begin
 for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('cash_up_summary','open_cash_up','submit_cash_up','review_cash_up','correct_cash_up_float','record_cash_movement','record_credit_payment_tender','classify_credit_payment') loop
  execute format('revoke all on function %s from public,anon',signature);
  execute format('grant execute on function %s to authenticated',signature);
 end loop;
end $f$;
