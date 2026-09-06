create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), store_id uuid not null,
  user_id uuid not null references auth.users(id), kind text not null check(kind in ('OUT_OF_STOCK','UPCOMING_EXPIRY','STOCK_TAKE_COMPLETED','LOW_STOCK','WEEKLY_PROFIT','OVERDUE_INVOICES')),
  enabled boolean not null default false, delivery_hour integer not null default 8 check(delivery_hour between 0 and 23),
  last_sent_at timestamptz, updated_at timestamptz not null default now(), unique(store_id,user_id,kind),
  foreign key(store_id,business_id) references public.stores(id,business_id)
);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(), preference_id uuid not null references public.notification_preferences(id),
  period text not null, state text not null check(state in ('CLAIMED','SENT','FAILED','SKIPPED')),
  recipient text not null, payload jsonb not null, attempts integer not null default 1,
  created_at timestamptz not null default now(), claimed_at timestamptz not null default now(),
  completed_at timestamptz, provider_id text, error text, unique(preference_id,period)
);
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_preferences,public.notification_deliveries from public,anon,authenticated;
grant select on public.notification_preferences,public.notification_deliveries to authenticated;
create policy notification_preferences_read on public.notification_preferences for select to authenticated using(user_id=auth.uid() and app.has_store_role(store_id,'manager'));
create policy notification_deliveries_read on public.notification_deliveries for select to authenticated using(exists(select 1 from public.notification_preferences p where p.id=preference_id));
create index notification_deliveries_claim on public.notification_deliveries(state,claimed_at);

create function public.set_notification_preference(p_store uuid,p_kind text,p_enabled boolean,p_hour integer default 8)
returns uuid language plpgsql security definer set search_path=public,app as $$
declare result uuid;
begin
  if not app.has_store_role(p_store,'manager') then raise exception 'FORBIDDEN'; end if;
  if p_kind is null or p_kind not in ('OUT_OF_STOCK','UPCOMING_EXPIRY','STOCK_TAKE_COMPLETED','LOW_STOCK','WEEKLY_PROFIT','OVERDUE_INVOICES') or p_enabled is null or p_hour is null or p_hour not between 0 and 23 then raise exception 'INVALID_NOTIFICATION_SETTINGS'; end if;
  insert into public.notification_preferences(business_id,store_id,user_id,kind,enabled,delivery_hour)
    values(app.store_business(p_store),p_store,auth.uid(),p_kind,p_enabled,p_hour)
    on conflict(store_id,user_id,kind) do update set enabled=excluded.enabled,delivery_hour=excluded.delivery_hour,updated_at=now() returning id into result;
  perform app.audit('notification.preference','notification_preferences',result,app.store_business(p_store),p_store,null,jsonb_build_object('kind',p_kind,'enabled',p_enabled,'hour',p_hour));
  return result;
end $$;

create function app.notification_data(p public.notification_preferences)
returns jsonb language plpgsql stable security definer set search_path=public,app as $$
declare result jsonb; rows jsonb; total integer; today date:=(now() at time zone 'Africa/Johannesburg')::date; weekstart date:=date_trunc('week',now() at time zone 'Africa/Johannesburg')::date;
begin
  if p.kind in ('OUT_OF_STOCK','LOW_STOCK') then
    select count(*) into total from public.v_product_stock where store_id=p.store_id and is_active and (case when p.kind='OUT_OF_STOCK' then quantity<=0 else quantity<=min_stock_level or quantity<=reorder_level end);
    select jsonb_agg(to_jsonb(x)) into rows from (select name,quantity,min_stock_level,reorder_level from public.v_product_stock where store_id=p.store_id and is_active and (case when p.kind='OUT_OF_STOCK' then quantity<=0 else quantity<=min_stock_level or quantity<=reorder_level end) order by name limit 100) x;
  elsif p.kind='UPCOMING_EXPIRY' then
    select count(*) into total from public.stock_batches where store_id=p.store_id and quantity>0 and expiry_date between today and today+30;
    select jsonb_agg(to_jsonb(x)) into rows from (select pr.name,b.quantity,b.expiry_date,b.batch_ref from public.stock_batches b join public.products pr on pr.id=b.product_id where b.store_id=p.store_id and b.quantity>0 and b.expiry_date between today and today+30 order by b.expiry_date limit 100) x;
  elsif p.kind='STOCK_TAKE_COMPLETED' then
    select count(*) into total from public.stock_takes where store_id=p.store_id and status='COMPLETED' and completed_at>coalesce(p.last_sent_at,now()-interval '1 day');
    select jsonb_agg(to_jsonb(x)) into rows from (select id,completed_at,note from public.stock_takes where store_id=p.store_id and status='COMPLETED' and completed_at>coalesce(p.last_sent_at,now()-interval '1 day') order by completed_at limit 100) x;
  elsif p.kind='OVERDUE_INVOICES' then
    select count(*) into total from public.v_invoice_balances where store_id=p.store_id and status='OVERDUE' and outstanding>0;
    select jsonb_agg(to_jsonb(x)) into rows from (select reference,customer_name,due_date,outstanding from public.v_invoice_balances where store_id=p.store_id and status='OVERDUE' and outstanding>0 order by due_date limit 100) x;
  else
    result:=app.profit_data(p.store_id,weekstart-7,weekstart-1);
    return jsonb_build_object('count',1,'from',weekstart-7,'to',weekstart-1,'metrics',result);
  end if;
  if total=0 then return null; end if;
  return jsonb_build_object('count',total,'rows',coalesce(rows,'[]'::jsonb),'as_of',now());
end $$;
revoke execute on function app.notification_data(public.notification_preferences) from public,anon,authenticated;

create function public.claim_notification_deliveries(p_limit integer default 20)
returns setof jsonb language plpgsql security definer set search_path=public,app as $$
declare p public.notification_preferences%rowtype; old public.notification_deliveries%rowtype; period_key text; local_now timestamp:=now() at time zone 'Africa/Johannesburg';
  body jsonb; recipient text; jid uuid; count_claimed integer:=0; location_name text; business_name text; currency text;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT'; end if;
  for p in select * from public.notification_preferences where enabled order by last_sent_at nulls first,id for update skip locked loop
    exit when count_claimed>=p_limit;
    if not app.member_manages_location(p.user_id,p.store_id) then continue; end if;
    if p.kind<>'STOCK_TAKE_COMPLETED' and extract(hour from local_now)<p.delivery_hour then continue; end if;
    period_key:=case when p.kind='WEEKLY_PROFIT' then date_trunc('week',local_now)::date::text when p.kind='STOCK_TAKE_COMPLETED' then to_char(local_now,'YYYY-MM-DD-HH24') else local_now::date::text end;
    select * into old from public.notification_deliveries where preference_id=p.id and
      (period=period_key or (state in ('CLAIMED','FAILED') and created_at>now()-interval '23 hours'))
      order by case when state in ('CLAIMED','FAILED') then 0 else 1 end,created_at limit 1 for update;
    if found then
      if old.state in ('SENT','SKIPPED') or old.attempts>=5 or old.claimed_at>now()-interval '10 minutes' or old.created_at<now()-interval '23 hours' then continue; end if;
      update public.notification_deliveries set state='CLAIMED',claimed_at=now(),attempts=attempts+1 where id=old.id;
      count_claimed:=count_claimed+1; return next jsonb_build_object('id',old.id,'recipient',old.recipient,'payload',old.payload); continue;
    end if;
    select u.email into recipient from auth.users u where u.id=p.user_id;
    if recipient is null then continue; end if;
    select s.name,b.name,b.currency into location_name,business_name,currency from public.stores s join public.businesses b on b.id=s.business_id where s.id=p.store_id;
    body:=app.notification_data(p);
    insert into public.notification_deliveries(preference_id,period,state,recipient,payload)
      values(p.id,period_key,case when body is null then 'SKIPPED' else 'CLAIMED' end,recipient,coalesce(body,'{}')||jsonb_build_object('kind',p.kind,'store',location_name,'business',business_name,'currency',currency)) returning id into jid;
    if body is null then continue; end if;
    count_claimed:=count_claimed+1;
    return next jsonb_build_object('id',jid,'recipient',recipient,'payload',body||jsonb_build_object('kind',p.kind,'store',location_name,'business',business_name,'currency',currency));
  end loop;
end $$;

create function public.complete_notification_delivery(p_delivery uuid,p_sent boolean,p_provider text default null,p_error text default null)
returns void language plpgsql security definer set search_path=public,app as $$
declare d public.notification_deliveries%rowtype;
begin
  select * into d from public.notification_deliveries where id=p_delivery;
  if not found then raise exception 'DELIVERY_NOT_FOUND'; end if;
  perform 1 from public.notification_preferences where id=d.preference_id for update;
  select * into d from public.notification_deliveries where id=p_delivery for update;
  if d.state='SENT' then return; end if;
  update public.notification_deliveries set state=case when p_sent then 'SENT' else 'FAILED' end,completed_at=now(),provider_id=p_provider,error=left(p_error,500) where id=d.id;
  if p_sent then update public.notification_preferences set last_sent_at=d.created_at where id=d.preference_id; end if;
end $$;
revoke execute on function public.set_notification_preference(uuid,text,boolean,integer),public.claim_notification_deliveries(integer),public.complete_notification_delivery(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.set_notification_preference(uuid,text,boolean,integer) to authenticated;
grant execute on function public.claim_notification_deliveries(integer),public.complete_notification_delivery(uuid,boolean,text,text) to service_role;
