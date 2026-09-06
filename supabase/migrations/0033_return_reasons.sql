-- Existing return descriptions remain unchanged. New returns must use an
-- owner-configured reason, optionally followed by ': ' and explanatory detail.
alter table public.billing_settings add column return_reasons text[] not null
  default array['Wrong item','Damaged','Expired','Faulty','Unwanted','Exchange','Other'];

create function public.set_return_reasons(p_business uuid,p_reasons text[])
returns void language plpgsql security definer set search_path=public,app as $$
declare cleaned text[]; previous text[];
begin
  if not app.has_business_role(p_business,'owner') then raise exception 'FORBIDDEN'; end if;
  if p_reasons is null or cardinality(p_reasons) not between 1 and 20 or array_ndims(p_reasons)<>1 then raise exception 'INVALID_RETURN_REASONS'; end if;
  select array_agg(btrim(value) order by ordinal) into cleaned from unnest(p_reasons) with ordinality as x(value,ordinal);
  if exists(select 1 from unnest(cleaned) r where r is null or length(r) not between 1 and 80 or r like '%:%' or r ~ '[[:cntrl:]]')
    or (select count(distinct lower(r)) from unnest(cleaned) r)<>cardinality(cleaned) then raise exception 'INVALID_RETURN_REASONS'; end if;
  select return_reasons into previous from public.billing_settings where business_id=p_business for update;
  insert into public.billing_settings(business_id,return_reasons) values(p_business,cleaned)
    on conflict(business_id) do update set return_reasons=excluded.return_reasons;
  perform app.audit('return.settings','business',p_business,p_business,null,
    jsonb_build_object('return_reasons',previous),jsonb_build_object('return_reasons',cleaned));
end $$;
revoke execute on function public.set_return_reasons(uuid,text[]) from public,anon;
grant execute on function public.set_return_reasons(uuid,text[]) to authenticated;

create function app.check_return_reason()
returns trigger language plpgsql security definer set search_path=public,app as $$
declare reasons text[]; category text;
begin
  select return_reasons into reasons from public.billing_settings where business_id=new.business_id;
  reasons:=coalesce(reasons,array['Wrong item','Damaged','Expired','Faulty','Unwanted','Exchange','Other']);
  category:=btrim(split_part(new.reason,':',1));
  if category is null or not(category=any(reasons)) then raise exception 'RETURN_REASON_NOT_CONFIGURED'; end if;
  if length(new.reason)>1000 then raise exception 'RETURN_REASON_TOO_LONG'; end if;
  if lower(category)='other' and (strpos(new.reason,':')=0 or nullif(btrim(substr(new.reason,strpos(new.reason,':')+1)),'') is null) then raise exception 'RETURN_REASON_DETAIL_REQUIRED'; end if;
  return new;
end $$;
revoke execute on function app.check_return_reason() from public,anon,authenticated;
create trigger return_reason_configured before insert on public.goods_returns
  for each row execute function app.check_return_reason();
