create function public.transfer_history(p_business uuid,p_source uuid default null,p_destination uuid default null,
  p_status text default null,p_product text default null,p_user uuid default null,p_from timestamptz default null,p_to timestamptz default null)
returns setof public.stock_transfers language plpgsql stable security definer set search_path=public,app as $$
begin
  if not app.is_business_member(p_business) then raise exception 'FORBIDDEN'; end if;
  return query select t.* from public.stock_transfers t
    where t.business_id=p_business and app.has_store_access(t.source_id) and app.has_store_access(t.destination_id)
      and (p_source is null or t.source_id=p_source) and (p_destination is null or t.destination_id=p_destination)
      and (p_status is null or t.status=p_status) and (p_user is null or p_user in (t.created_by,t.dispatched_by,t.received_by))
      and (p_from is null or t.created_at>=p_from) and (p_to is null or t.created_at<p_to)
      and (nullif(btrim(p_product),'') is null or exists(select 1 from public.stock_transfer_items i where i.transfer_id=t.id
        and (i.source_name ilike '%'||p_product||'%' or i.destination_name ilike '%'||p_product||'%')))
    order by t.created_at desc,t.id limit 200;
end $$;
revoke execute on function public.transfer_history(uuid,uuid,uuid,text,text,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.transfer_history(uuid,uuid,uuid,text,text,uuid,timestamptz,timestamptz) to authenticated;
