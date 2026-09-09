-- Keep every approved count while allowing sequential shifts in one store/day.
alter table public.cash_ups drop constraint cash_ups_store_id_business_date_key;
alter table public.cash_ups add column shift_number integer not null default 1 check(shift_number>0),
 add column previous_shift uuid references public.cash_ups(id),
 add column baseline jsonb not null default '{}',
 add column handover_note text,
 add column start_request uuid;
create unique index cash_shift_number on public.cash_ups(store_id,business_date,shift_number);
create unique index cash_shift_successor on public.cash_ups(previous_shift) where previous_shift is not null;
create unique index cash_shift_start_request on public.cash_ups(store_id,start_request) where start_request is not null;
create unique index cash_shift_active_day on public.cash_ups(store_id,business_date) where status<>'APPROVED';

-- Snapshot subtraction, rather than time cutoffs, includes transactions that
-- started before a handover but committed afterwards. Day locks serialize it.
create function app.cash_shift_sources(p_shift uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.cash_ups%rowtype; source jsonb; result jsonb; k text; activity jsonb:='{}';
begin
 select * into c from public.cash_ups where id=p_shift;
 if exists(select 1 from public.cash_ups where previous_shift=c.id) then
  return (select sources from public.cash_up_submissions where id=c.latest_submission);
 end if;
 source:=app.cash_sources(c.store_id,c.business_date);result:=source;
 foreach k in array array['sales','invoices','credit','refunds','added','removed','net'] loop
  result:=jsonb_set(result,array[k],to_jsonb(coalesce((source->>k)::numeric,0)-coalesce((c.baseline->>k)::numeric,0)));
 end loop;
 for k in select jsonb_object_keys(source->'activity') loop
  activity:=jsonb_set(activity,array[k],to_jsonb((source->'activity'->>k)::numeric-coalesce((c.baseline->'activity'->>k)::numeric,0)));
 end loop;
 return result||jsonb_build_object('activity',activity,'cumulative',source);
end $$;
revoke all on function app.cash_shift_sources(uuid) from public,anon,authenticated;

create function public.start_next_cash_shift(p_previous uuid,p_float numeric,p_note text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.cash_ups%rowtype; prior public.cash_ups%rowtype; s public.cash_up_submissions%rowtype; result uuid;
begin
 select * into c from public.cash_ups where id=p_previous;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(c.store_id,array['cash_up']);
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 if p_float is null or p_float::text in ('NaN','Infinity','-Infinity') or p_float<0 or p_float<>round(p_float,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into prior from public.cash_ups where store_id=c.store_id and start_request=p_request;
 if found then
  if prior.previous_shift<>p_previous or prior.opening_float<>p_float or prior.created_by<>auth.uid() or prior.handover_note is distinct from nullif(btrim(p_note),'') then raise exception 'REQUEST_CONFLICT';end if;
  return prior.id;
 end if;
 select * into c from public.cash_ups where id=p_previous for update;
 if c.status<>'APPROVED' then raise exception 'SHIFT_APPROVAL_REQUIRED';end if;
 if exists(select 1 from public.cash_ups where previous_shift=c.id) then raise exception 'SHIFT_ALREADY_STARTED';end if;
 if c.business_date<>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'SHIFT_DATE_NOT_TODAY';end if;
 select * into s from public.cash_up_submissions where id=c.latest_submission;
 if s.id is null then raise exception 'SHIFT_APPROVAL_REQUIRED';end if;
 if p_float<>s.counted and nullif(btrim(p_note),'') is null then raise exception 'HANDOVER_NOTE_REQUIRED';end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'NOTE_TOO_LONG';end if;
 insert into public.cash_ups(business_id,store_id,business_date,opening_float,created_by,shift_number,previous_shift,baseline,handover_note,start_request)
 values(c.business_id,c.store_id,c.business_date,p_float,auth.uid(),c.shift_number+1,c.id,coalesce(s.sources->'cumulative',s.sources)-'opening_float',nullif(btrim(p_note),''),p_request) returning id into result;
 perform app.audit('cash_up.handover','cash_up',result,c.business_id,c.store_id,jsonb_build_object('previous_shift',c.id,'counted',s.counted),jsonb_build_object('opening_float',p_float,'note',p_note));
 return result;
end $$;
revoke all on function public.start_next_cash_shift(uuid,numeric,text,uuid) from public,anon;
grant execute on function public.start_next_cash_shift(uuid,numeric,text,uuid) to authenticated;

create or replace function app.cash_shift_summary(p_store uuid,p_day date,p_shift uuid) returns jsonb
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype; source jsonb; history jsonb;
begin
 perform app.require_module(p_store,array['cash_up']);
 if p_day is null then raise exception 'INVALID_DATE'; end if;
 select * into c from public.cash_ups where store_id=p_store and business_date=p_day and (p_shift is null or id=p_shift) order by shift_number desc limit 1;
 if p_shift is not null and c.id is null then raise exception 'FORBIDDEN';end if;
 source:=case when c.id is null then app.cash_sources(p_store,p_day) else app.cash_shift_sources(c.id) end;
 select coalesce(jsonb_agg(to_jsonb(s)-'request_payload'-'request_id' || jsonb_build_object('created_by_name',coalesce(p.full_name,'Team member'),
  'reviews',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('created_by_name',coalesce(rp.full_name,'Manager')) order by r.created_at),'[]'::jsonb) from public.cash_up_reviews r left join public.profiles rp on rp.id=r.created_by where r.submission_id=s.id)) order by s.revision desc),'[]'::jsonb)
 into history from public.cash_up_submissions s left join public.profiles p on p.id=s.created_by where s.cash_up_id=c.id;
 return jsonb_build_object('day_activity',app.cash_sources(p_store,p_day)->'activity','sealed',exists(select 1 from public.cash_ups where previous_shift=c.id),'started_by_name',(select full_name from public.profiles where id=c.created_by),'shifts',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'shift_number',x.shift_number,'status',x.status,'created_by_name',coalesce(p.full_name,'Team member'),'created_at',x.created_at,'opening_float',x.opening_float) order by x.shift_number),'[]') from public.cash_ups x left join public.profiles p on p.id=x.created_by where x.store_id=p_store and x.business_date=p_day),'session',case when c.id is null then null else to_jsonb(c) end,'sources',source,'history',history,
  'expected',coalesce(c.opening_float,0)+(source->>'net')::numeric,
  'count_token',md5((source->>'fingerprint')||':'||c.opening_float::text||':'||c.version::text),
  'changed_since_count',c.latest_submission is not null and source->>'fingerprint' is distinct from (select sources->>'fingerprint' from public.cash_up_submissions where id=c.latest_submission),
  'movements',(select coalesce(jsonb_agg(to_jsonb(d)-'request_payload'-'request_id' order by created_at desc),'[]'::jsonb) from public.cash_drawer_movements d where store_id=p_store and business_date=p_day));
end $f$;
revoke all on function app.cash_shift_summary(uuid,date,uuid) from public,anon,authenticated;
create or replace function public.cash_up_summary(p_store uuid,p_day date) returns jsonb language sql security definer set search_path='' as $$ select app.cash_shift_summary(p_store,p_day,null); $$;
create function public.cash_shift_summary(p_store uuid,p_day date,p_shift uuid default null) returns jsonb language sql security definer set search_path='' as $$ select app.cash_shift_summary(p_store,p_day,p_shift); $$;
revoke all on function public.cash_shift_summary(uuid,date,uuid) from public,anon;
grant execute on function public.cash_shift_summary(uuid,date,uuid) to authenticated;

create or replace function public.open_cash_up(p_store uuid,p_day date,p_float numeric) returns uuid
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype;
begin
 perform app.require_module(p_store,array['cash_up']);
 if not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
 if p_day is null or p_day>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'INVALID_DATE'; end if;
 if p_float is null or p_float::text in ('NaN','Infinity','-Infinity') or p_float<0 or p_float<>round(p_float,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 perform app.cash_day_lock(p_store,p_day);
 select * into c from public.cash_ups where store_id=p_store and business_date=p_day order by shift_number desc limit 1;
 if found then if c.opening_float<>p_float then raise exception 'CASH_UP_ALREADY_OPEN'; end if; return c.id; end if;
 insert into public.cash_ups(business_id,store_id,business_date,opening_float,created_by) values(app.store_business(p_store),p_store,p_day,p_float,auth.uid()) returning * into c;
 perform app.audit('cash_up.open','cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('date',p_day,'opening_float',p_float));
 return c.id;
end $f$;

create or replace function public.submit_cash_up(p_cash_up uuid,p_counted numeric,p_denominations jsonb,p_fingerprint text,p_note text,p_request uuid) returns uuid
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
 source:=app.cash_shift_sources(c.id);
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

create or replace function public.review_cash_up(p_cash_up uuid,p_submission uuid,p_action text,p_note text) returns void
language plpgsql security definer set search_path=public,app as $f$
declare c public.cash_ups%rowtype; s public.cash_up_submissions%rowtype; source jsonb;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 if not app.has_store_role(c.store_id,'manager') then raise exception 'FORBIDDEN'; end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if exists(select 1 from public.cash_ups where previous_shift=c.id) then raise exception 'SHIFT_LOCKED';end if;
 if p_submission is null or p_submission is distinct from c.latest_submission then raise exception 'CASH_UP_CHANGED'; end if;
 select * into s from public.cash_up_submissions where id=p_submission;
 if p_action='APPROVE' then
  if c.status='APPROVED' then return; end if;
  if c.status<>'SUBMITTED' then raise exception 'CASH_UP_CHANGED'; end if;
  source:=app.cash_shift_sources(c.id);
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

create or replace function public.save_product_details(p_product uuid,p_values jsonb,p_expiry date default null,p_expected numeric default null)
returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; total numeric; undated numeric; current_barcode text; new_barcode text; barcode_id uuid;
begin
 select * into p from public.products where id=p_product;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p.store_id,array['products']);
 select quantity into total from public.stock where product_id=p.id and store_id=p.store_id for update;
 select greatest(coalesce(total,0)-coalesce(sum(quantity) filter(where expiry_date is not null),0),0) into undated from public.stock_batches where product_id=p.id and store_id=p.store_id;
 if coalesce((p_values->>'track_expiry')::boolean,false) and undated>0 then
  if p_expiry is null then raise exception 'EXPIRY_REQUIRED'; end if;
  perform public.assign_stock_expiry(p.id,p_expiry,undated,p_expected);
 end if;
 if p_values ? 'barcode' then
  new_barcode:=btrim(p_values->>'barcode');
  select id,barcode into barcode_id,current_barcode from public.product_barcodes where product_id=p.id and is_active order by created_at,id limit 1 for update;
  if current_barcode is distinct from nullif(p_values->>'expected_barcode','') then raise exception 'BARCODE_CHANGED_REFRESH';end if;
  if nullif(new_barcode,'') is null or length(new_barcode)>128 then raise exception 'INVALID_BARCODE';end if;
  if new_barcode is distinct from current_barcode then
   if exists(select 1 from public.product_barcodes where store_id=p.store_id and barcode=new_barcode and is_active) then raise exception 'BARCODE_ALREADY_EXISTS';end if;
   if barcode_id is not null then update public.product_barcodes set is_active=false where id=barcode_id;end if;
   insert into public.product_barcodes(product_id,store_id,barcode) values(p.id,p.store_id,new_barcode);
   perform app.audit('product.barcode','products',p.id,p.business_id,p.store_id,jsonb_build_object('barcode',current_barcode),jsonb_build_object('barcode',new_barcode));
  end if;
 end if;
 if nullif(btrim(p_values->>'name'),'') is null then raise exception 'PRODUCT_NAME_REQUIRED'; end if;
 update public.products set name=btrim(p_values->>'name'),cost_price=(p_values->>'cost_price')::numeric,
 selling_price=(p_values->>'selling_price')::numeric,min_stock_level=(p_values->>'min_stock_level')::numeric,
 reorder_level=(p_values->>'reorder_level')::numeric,unit=coalesce(nullif(btrim(p_values->>'unit'),''),'each'),
 track_expiry=(p_values->>'track_expiry')::boolean,is_active=(p_values->>'is_active')::boolean where id=p.id;
 perform app.audit('product.edit','products',p.id,p.business_id,p.store_id,to_jsonb(p),p_values);
end $$;

create or replace function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
    'cash_shifts_v1', to_regprocedure('public.start_next_cash_shift(uuid,numeric,text,uuid)') is not null,
    'batch_expiry_v1', to_regprocedure('app.take_sellable_batches(uuid,uuid,numeric)') is not null and to_regclass('public.v_product_catalog') is not null,
    'employee_invitations_v1', to_regprocedure('public.accept_employee_invitation(uuid,text,text,text,text)') is not null and to_regprocedure('public.my_employee_setup()') is not null,
    'document_workflows_v1', to_regprocedure('public.convert_quote(uuid,jsonb,bigint)') is not null and to_regprocedure('public.return_refund_summary(uuid)') is not null and to_regprocedure('public.stock_export(uuid,text,text)') is not null and to_regprocedure('public.download_purchase_order(uuid)') is not null,
    'order_workflow_v1', to_regprocedure('public.order_workflow_summary(uuid)') is not null,
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
