-- Public registration stays open for testing. Only the platform operator can
-- change this setting; a customer owner cannot reopen closed registration.
create table app.registration_settings (singleton boolean primary key default true check(singleton), public_signup boolean not null default true);
insert into app.registration_settings values(true,true);
alter table app.registration_settings enable row level security;
revoke all on app.registration_settings from public,anon,authenticated;

alter table public.profiles add column first_name text, add column surname text;
create table public.employee_invitations (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id),
 email text not null check(email=lower(btrim(email)) and length(email)<=254 and email like '%@%.%'),
 role app.membership_role not null, first_name text not null default '', surname text not null default '', phone text not null default '',
 assignments jsonb not null default '{}' check(jsonb_typeof(assignments)='object'),
 state text not null default 'PENDING' check(state in ('PENDING','ACCEPTED','CANCELLED')),
 delivery text not null default 'QUEUED' check(delivery in ('QUEUED','SENT','FAILED')),
 expires_at timestamptz not null default now()+interval '7 days', version bigint not null default 1,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 user_id uuid references auth.users(id), accepted_at timestamptz, sent_at timestamptz,
 request_id uuid not null, request_payload jsonb not null,
 unique(business_id,request_id)
);
create unique index employee_invitation_pending on public.employee_invitations(business_id,email) where state='PENDING';
create index employee_invitation_user on public.employee_invitations(user_id);
create index employee_invitation_email on public.employee_invitations(email);
create index employee_invitation_creator on public.employee_invitations(created_by);
alter table public.employee_invitations enable row level security;
revoke all on public.employee_invitations from public,anon,authenticated;
grant select on public.employee_invitations to authenticated;
create policy invitation_owner_read on public.employee_invitations for select to authenticated using(app.has_business_role(business_id,'owner'));

create table app.invitation_secrets(invitation_id uuid primary key references public.employee_invitations(id), token_hash text not null, version bigint not null);
create table app.managed_identities(user_id uuid primary key references auth.users(id), email text not null, setup_complete boolean not null default false);
alter table app.invitation_secrets enable row level security;
alter table app.managed_identities enable row level security;
revoke all on app.invitation_secrets,app.managed_identities from public,anon,authenticated;

create function app.guard_employee_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.is_active and exists(select 1 from app.managed_identities where user_id=new.user_id and not setup_complete) then raise exception 'EMPLOYEE_SETUP_REQUIRED'; end if;
 return new;
end $$;
revoke all on function app.guard_employee_membership() from public,anon,authenticated;
create trigger employee_setup_before_membership before insert or update of is_active,user_id on public.memberships for each row execute function app.guard_employee_membership();

create function public.registration_open() returns boolean language sql stable security definer set search_path='' as $$ select public_signup from app.registration_settings where singleton $$;
revoke all on function public.registration_open() from public;
grant execute on function public.registration_open() to anon,authenticated,service_role;
create function public.set_registration_open(p_open boolean) returns void language sql security definer set search_path='' as $$ update app.registration_settings set public_signup=p_open where singleton $$;
revoke all on function public.set_registration_open(boolean) from public,anon,authenticated;
grant execute on function public.set_registration_open(boolean) to service_role;

-- The guard covers direct Auth API writes as well as the application form.
create function app.guard_managed_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if not public.registration_open() and not exists(select 1 from public.employee_invitations where email=lower(new.email) and state='PENDING' and expires_at>now()) then raise exception 'REGISTRATION_CLOSED'; end if;
 elsif exists(select 1 from app.managed_identities where user_id=old.id) and
   (new.email is distinct from old.email or (coalesce(new.email_change,'')<>'' and new.email_change is distinct from old.email_change)) then
  raise exception 'EMAIL_MANAGED_BY_EMPLOYER';
 end if;
 return new;
end $$;
revoke all on function app.guard_managed_identity() from public,anon,authenticated;
create trigger guard_employee_identity before insert or update of email,email_change on auth.users for each row execute function app.guard_managed_identity();
create function app.mark_invited_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.employee_invitations where email=lower(new.email) and state='PENDING' and expires_at>now()) then
  insert into app.managed_identities(user_id,email) values(new.id,lower(new.email)) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function app.mark_invited_identity() from public,anon,authenticated;
create trigger mark_employee_identity after insert on auth.users for each row execute function app.mark_invited_identity();

create function public.my_employee_setup() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('managed',exists(select 1 from app.managed_identities where user_id=auth.uid()),'required',exists(select 1 from app.managed_identities where user_id=auth.uid() and not setup_complete))
$$;
revoke all on function public.my_employee_setup() from public,anon;
grant execute on function public.my_employee_setup() to authenticated;

alter function public.create_business(text,text) set schema app;
revoke all on function app.create_business(text,text) from public,anon,authenticated;
create function public.create_business(p_name text,p_store_name text default 'Main Store') returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.registration_open() or exists(select 1 from app.managed_identities where user_id=auth.uid()) then raise exception 'INVITATION_REQUIRED'; end if;
 return app.create_business(p_name,p_store_name);
end $$;
revoke all on function public.create_business(text,text) from public,anon;
grant execute on function public.create_business(text,text) to authenticated;

create function app.validate_invitation_access(p_business uuid,p_role app.membership_role,p_assignments jsonb) returns void language plpgsql security definer set search_path='' as $$
declare pair record; permission record;
begin
 if p_assignments is null or jsonb_typeof(p_assignments)<>'object' or octet_length(p_assignments::text)>30000 then raise exception 'INVALID_INVITATION_ACCESS'; end if;
 if p_role<>'owner' and p_assignments='{}'::jsonb then raise exception 'LOCATIONS_REQUIRED'; end if;
 for pair in select * from jsonb_each(p_assignments) loop
  if not exists(select 1 from public.stores where id=pair.key::uuid and business_id=p_business and is_active) or jsonb_typeof(pair.value)<>'object' then raise exception 'INVALID_LOCATION'; end if;
  for permission in select * from jsonb_each(pair.value) loop
   if jsonb_typeof(permission.value)<>'boolean' or not exists(select 1 from public.module_catalog where key=permission.key and (permission.value='false'::jsonb or app.role_rank(minimum_role)<=app.role_rank(p_role))) then raise exception 'INVALID_MODULE_ACCESS'; end if;
  end loop;
 end loop;
end $$;
revoke all on function app.validate_invitation_access(uuid,app.membership_role,jsonb) from public,anon,authenticated;

create function public.save_employee_invitation(p_business uuid,p_email text,p_role app.membership_role,p_assignments jsonb,p_request uuid,p_first_name text default '',p_surname text default '',p_phone text default '',p_invitation uuid default null,p_expected bigint default null) returns uuid language plpgsql security definer set search_path='' as $$
declare item public.employee_invitations%rowtype; payload jsonb; result uuid;
begin
 if not app.has_business_role(p_business,'owner') then raise exception 'FORBIDDEN'; end if;
 if p_request is null or p_email is null or length(btrim(p_email))>254 or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_first_name)>100 or length(p_surname)>100 or length(p_phone)>32 then raise exception 'INVALID_INVITATION'; end if;
 perform app.validate_invitation_access(p_business,p_role,p_assignments);
 payload:=jsonb_build_object('email',lower(btrim(p_email)),'role',p_role,'assignments',p_assignments,'first_name',p_first_name,'surname',p_surname,'phone',p_phone);
 if p_invitation is null then
  perform pg_advisory_xact_lock(hashtextextended(p_business::text||lower(btrim(p_email)),0));
  select * into item from public.employee_invitations where business_id=p_business and request_id=p_request;
  if found then
   if item.request_payload<>payload then raise exception 'INVITATION_REQUEST_CHANGED'; end if;
   return item.id;
  end if;
  if exists(select 1 from public.memberships m join auth.users u on u.id=m.user_id where m.business_id=p_business and lower(u.email)=lower(btrim(p_email))) then raise exception 'USER_ALREADY_MEMBER'; end if;
  update public.employee_invitations set state='CANCELLED',version=version+1 where business_id=p_business and email=lower(btrim(p_email)) and state='PENDING' and expires_at<=now();
  if exists(select 1 from public.employee_invitations where business_id=p_business and email=lower(btrim(p_email)) and state='PENDING') then raise exception 'INVITATION_ALREADY_PENDING'; end if;
  if (select count(*) from public.employee_invitations where created_by=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'INVITATION_RATE_LIMITED'; end if;
  insert into public.employee_invitations(business_id,email,role,assignments,created_by,request_id,request_payload,first_name,surname,phone)
  values(p_business,lower(btrim(p_email)),p_role,p_assignments,auth.uid(),p_request,payload,btrim(p_first_name),btrim(p_surname),btrim(p_phone)) returning id into result;
 else
  select * into item from public.employee_invitations where id=p_invitation and business_id=p_business for update;
  if not found or item.state<>'PENDING' or item.version is distinct from p_expected then raise exception 'INVITATION_CHANGED'; end if;
  if item.email<>lower(btrim(p_email)) then raise exception 'CANCEL_AND_REINVITE_TO_CHANGE_EMAIL'; end if;
  update public.employee_invitations set role=p_role,assignments=p_assignments,first_name=btrim(p_first_name),surname=btrim(p_surname),phone=btrim(p_phone),version=version+1 where id=item.id;
  -- Invalidate the old acceptance link when its access summary changes.
  delete from app.invitation_secrets where invitation_id=item.id;
  update public.employee_invitations set delivery='QUEUED' where id=item.id;
  result:=item.id;
 end if;
 perform app.audit('invitation.save','invitation',result,p_business,null,null,jsonb_build_object('role',p_role,'assignments',p_assignments));
 return result;
end $$;
revoke all on function public.save_employee_invitation(uuid,text,app.membership_role,jsonb,uuid,text,text,text,uuid,bigint) from public,anon;
grant execute on function public.save_employee_invitation(uuid,text,app.membership_role,jsonb,uuid,text,text,text,uuid,bigint) to authenticated;

create function public.cancel_employee_invitation(p_invitation uuid,p_expected bigint) returns void language plpgsql security definer set search_path='' as $$
declare item public.employee_invitations%rowtype;
begin
 select * into item from public.employee_invitations where id=p_invitation for update;
 if not found or not app.has_business_role(item.business_id,'owner') then raise exception 'FORBIDDEN'; end if;
 if item.state<>'PENDING' or item.version is distinct from p_expected then raise exception 'INVITATION_CHANGED'; end if;
 update public.employee_invitations set state='CANCELLED',version=version+1 where id=item.id;
 delete from app.invitation_secrets where invitation_id=item.id;
 perform app.audit('invitation.cancel','invitation',item.id,item.business_id,null,null,null);
end $$;
revoke all on function public.cancel_employee_invitation(uuid,bigint) from public,anon;
grant execute on function public.cancel_employee_invitation(uuid,bigint) to authenticated;

-- Server-only delivery preparation. Neither owners nor invitees can obtain
-- another user's auth link through this function.
create function public.prepare_employee_invitation_delivery(p_actor uuid,p_invitation uuid,p_expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.employee_invitations%rowtype; secret text; uid uuid; existing boolean;
begin
 select * into item from public.employee_invitations where id=p_invitation for update;
 if not found or not exists(select 1 from public.memberships where business_id=item.business_id and user_id=p_actor and role='owner' and is_active) then raise exception 'FORBIDDEN'; end if;
 if item.state<>'PENDING' or item.version is distinct from p_expected then raise exception 'INVITATION_CHANGED'; end if;
 if item.sent_at>now()-interval '60 seconds' then raise exception 'INVITATION_RATE_LIMITED'; end if;
 if not exists(select 1 from public.memberships where business_id=item.business_id and user_id=item.created_by and role='owner' and is_active) then raise exception 'INVITER_NO_LONGER_AUTHORIZED'; end if;
 perform app.validate_invitation_access(item.business_id,item.role,item.assignments);
 select id into uid from auth.users where lower(email)=item.email;
 existing:=uid is not null;
 -- Existing accounts become employer-managed only when they accept. Merely
 -- inviting an address must not let an owner lock somebody else's identity.
 secret:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 update public.employee_invitations set version=version+1,delivery='QUEUED',expires_at=now()+interval '1 hour',sent_at=now(),user_id=uid where id=item.id returning * into item;
 insert into app.invitation_secrets values(item.id,encode(sha256(convert_to(secret,'UTF8')),'hex'),item.version)
 on conflict(invitation_id) do update set token_hash=excluded.token_hash,version=excluded.version;
 perform app.audit('invitation.delivery_attempt','invitation',item.id,item.business_id,null,null,jsonb_build_object('version',item.version,'requested_by',p_actor));
 return jsonb_build_object('id',item.id,'email',item.email,'version',item.version,'secret',secret,'existing',existing,'expires_at',item.expires_at,'business',(select name from public.businesses where id=item.business_id));
end $$;
revoke all on function public.prepare_employee_invitation_delivery(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.prepare_employee_invitation_delivery(uuid,uuid,bigint) to service_role;

create function public.finish_employee_invitation_delivery(p_invitation uuid,p_version bigint,p_user uuid,p_sent boolean) returns void language plpgsql security definer set search_path='' as $$
declare business uuid;
begin
 if not exists(select 1 from public.employee_invitations i join auth.users u on lower(u.email)=i.email where i.id=p_invitation and u.id=p_user) then raise exception 'INVITATION_IDENTITY_MISMATCH'; end if;
 update public.employee_invitations set delivery=case when p_sent then 'SENT' else 'FAILED' end,user_id=p_user where id=p_invitation and version=p_version and state='PENDING' returning business_id into business;
 if found then perform app.audit('invitation.delivery_result','invitation',p_invitation,business,null,null,jsonb_build_object('version',p_version,'sent',p_sent)); end if;
end $$;
revoke all on function public.finish_employee_invitation_delivery(uuid,bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function public.finish_employee_invitation_delivery(uuid,bigint,uuid,boolean) to service_role;

create function public.employee_invitation_details(p_invitation uuid,p_secret text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.employee_invitations%rowtype; uid uuid:=auth.uid();
begin
 select * into item from public.employee_invitations where id=p_invitation;
 if uid is null or not found or length(p_secret)<>64 or not exists(select 1 from auth.users where id=uid and lower(email)=item.email and email_confirmed_at is not null) or not exists(select 1 from app.invitation_secrets where invitation_id=item.id and token_hash=encode(sha256(convert_to(p_secret,'UTF8')),'hex')) then raise exception 'INVITATION_INVALID'; end if;
 if item.state='CANCELLED' or (item.state='PENDING' and item.expires_at<=now()) then raise exception 'INVITATION_EXPIRED_OR_CANCELLED'; end if;
 return jsonb_build_object('id',item.id,'email',item.email,'business',(select name from public.businesses where id=item.business_id),'role',item.role,'state',item.state,'first_name',coalesce(nullif((select first_name from public.profiles where id=uid),''),item.first_name),'surname',coalesce(nullif((select surname from public.profiles where id=uid),''),item.surname),'phone',coalesce(nullif((select phone from public.profiles where id=uid),''),item.phone),'needs_password',exists(select 1 from auth.users where id=uid and coalesce(encrypted_password,'')=''),'assignments',item.assignments,'stores',(select coalesce(jsonb_object_agg(id,name),'{}') from public.stores where business_id=item.business_id));
end $$;
revoke all on function public.employee_invitation_details(uuid,text) from public,anon;
grant execute on function public.employee_invitation_details(uuid,text) to authenticated;

create function public.accept_employee_invitation(p_invitation uuid,p_secret text,p_first_name text,p_surname text,p_phone text) returns void language plpgsql security definer set search_path='' as $$
declare item public.employee_invitations%rowtype; uid uuid:=auth.uid(); mid uuid; pair record; perms jsonb;
begin
 select * into item from public.employee_invitations where id=p_invitation for update;
 perform public.employee_invitation_details(p_invitation,p_secret);
 if item.state='ACCEPTED' and item.user_id=uid then return; end if;
 if item.state<>'PENDING' then raise exception 'INVITATION_INVALID'; end if;
 if not exists(select 1 from public.memberships where business_id=item.business_id and user_id=item.created_by and role='owner' and is_active) then raise exception 'INVITER_NO_LONGER_AUTHORIZED'; end if;
 if coalesce(length(btrim(p_first_name)),0) not between 1 and 100 or coalesce(length(btrim(p_surname)),0) not between 1 and 100 or p_phone is null or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 7 and 15 or p_phone !~ '^\+?[0-9 ()-]{7,32}$' then raise exception 'PROFILE_DETAILS_REQUIRED'; end if;
 if not exists(select 1 from auth.users where id=uid and coalesce(encrypted_password,'')<>'') then raise exception 'PASSWORD_REQUIRED'; end if;
 perform app.validate_invitation_access(item.business_id,item.role,item.assignments);
 if exists(select 1 from public.memberships where business_id=item.business_id and user_id=uid) then raise exception 'USER_ALREADY_MEMBER'; end if;
 update public.profiles set first_name=btrim(p_first_name),surname=btrim(p_surname),full_name=btrim(p_first_name)||' '||btrim(p_surname),phone=btrim(p_phone) where id=uid;
 insert into app.managed_identities values(uid,item.email,true) on conflict(user_id) do update set setup_complete=true;
 insert into public.memberships(business_id,user_id,role,is_active) values(item.business_id,uid,item.role,true) returning id into mid;
 if item.role<>'owner' then
  for pair in select * from jsonb_each(item.assignments) loop
   insert into public.store_memberships(membership_id,store_id,business_id,assigned_by) values(mid,pair.key::uuid,item.business_id,item.created_by);
   select jsonb_object_agg(key,coalesce((pair.value->>key)::boolean,false)) into perms from public.module_catalog;
   insert into public.store_module_access(membership_id,store_id,permissions,updated_by) values(mid,pair.key::uuid,perms,item.created_by);
  end loop;
 end if;
 update public.employee_invitations set state='ACCEPTED',accepted_at=now(),user_id=uid where id=item.id;
 perform app.audit('invitation.accept','invitation',item.id,item.business_id,null,null,jsonb_build_object('membership',mid));
end $$;
revoke all on function public.accept_employee_invitation(uuid,text,text,text,text) from public,anon;
grant execute on function public.accept_employee_invitation(uuid,text,text,text,text) to authenticated;

create or replace function public.app_schema_status() returns jsonb
language sql stable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('version',1,'capabilities',jsonb_build_object(
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
