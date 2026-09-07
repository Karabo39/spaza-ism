create function public.stock_export(p_store uuid,p_status text default 'all',p_search text default '') returns jsonb
language plpgsql stable security definer set search_path=public,app as $$
declare result jsonb; n integer;
begin
 perform app.require_module(p_store,array['check_stock']);
 if p_status is null or p_status not in ('all','ok','low','out','reorder','inactive') or length(p_search)>200 then raise exception 'INVALID_FILTER'; end if;
 select count(*),coalesce(jsonb_agg(to_jsonb(s) order by s.name,s.id),'[]'::jsonb) into n,result from
 (select id,name,category_name,quantity,unit,stock_status,is_active,cost_price,selling_price,stock_value from public.v_product_stock
 where store_id=p_store and is_active=(p_status<>'inactive') and name ilike '%'||coalesce(p_search,'')||'%'
 and (p_status in ('all','inactive') or stock_status=p_status) order by name,id limit 5001) s;
 if n>5000 then raise exception 'EXPORT_TOO_LARGE'; end if;
 return result;
end $$;
revoke all on function public.stock_export(uuid,text,text) from public,anon;
grant execute on function public.stock_export(uuid,text,text) to authenticated;
-- Reuse delivery retries and rate limits for these module-specific reports.
create or replace function public.prepare_report_email(p_store uuid,p_request uuid,p_hash text,p_recipient text) returns jsonb
language plpgsql security definer set search_path=public,app as $$
begin
 perform app.require_module(p_store,array['reports','check_stock','invoices']);
 return app_private.prepare_report_email(p_store,p_request,p_hash,p_recipient);
end $$;
create or replace function public.complete_report_email(p_job uuid,p_provider text) returns void
language plpgsql security definer set search_path=public,app as $$
begin
 perform app.require_module((select store_id from public.report_email_jobs where id=p_job),array['reports','check_stock','invoices']);
 perform app_private.complete_report_email(p_job,p_provider);
end $$;
