-- Private image bucket; only owners write, active business members read.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('business-logos','business-logos',false,2097152,array['image/png','image/jpeg','image/webp'])
  on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function app.logo_business(p_name text) returns uuid language plpgsql immutable set search_path=public,app as $$
begin
  if p_name is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$' then return null; end if;
  return split_part(p_name,'/',1)::uuid;
exception when invalid_text_representation then return null;
end $$;
revoke execute on function app.logo_business(text) from public,anon;
grant execute on function app.logo_business(text) to authenticated;
alter table public.businesses add column logo_path text;
alter table public.businesses add constraint business_logo_path_scope check(logo_path is null or coalesce(app.logo_business(logo_path)=id,false));
create policy business_logo_read on storage.objects for select to authenticated using(bucket_id='business-logos' and app.is_business_member(app.logo_business(name)));
create policy business_logo_insert on storage.objects for insert to authenticated with check(bucket_id='business-logos' and app.has_business_role(app.logo_business(name),'owner'));
create policy business_logo_delete on storage.objects for delete to authenticated using(bucket_id='business-logos' and app.has_business_role(app.logo_business(name),'owner') and not exists(select 1 from public.businesses b where b.logo_path=storage.objects.name));
create function app.validate_business_logo() returns trigger language plpgsql security definer set search_path=public,app as $$
begin
  if (tg_op='INSERT' and new.logo_path is not null) or (tg_op='UPDATE' and new.logo_path is distinct from old.logo_path) then
    if not app.has_business_role(new.id,'owner') then raise exception 'FORBIDDEN'; end if;
    if new.logo_path is not null and (app.logo_business(new.logo_path) is distinct from new.id or not exists(select 1 from storage.objects where bucket_id='business-logos' and name=new.logo_path)) then raise exception 'LOGO_NOT_FOUND'; end if;
    perform app.audit('business.logo','businesses',new.id,new.id,null,case when tg_op='UPDATE' then jsonb_build_object('path',old.logo_path) end,jsonb_build_object('path',new.logo_path));
  end if;
  return new;
end $$;
create trigger validate_business_logo before insert or update of logo_path on public.businesses for each row execute function app.validate_business_logo();
create function public.set_business_logo(p_business uuid,p_path text) returns void language plpgsql security definer set search_path=public,app as $$
begin
  if not app.has_business_role(p_business,'owner') then raise exception 'FORBIDDEN'; end if;
  update public.businesses set logo_path=p_path where id=p_business;
end $$;
revoke execute on function app.validate_business_logo() from public,anon,authenticated;
revoke execute on function public.set_business_logo(uuid,text) from public,anon;
grant execute on function public.set_business_logo(uuid,text) to authenticated;
