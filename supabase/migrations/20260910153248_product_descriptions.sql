-- Optional metadata; no changes to existing stock or financial amounts.
alter table public.products add column description text;
alter table public.products add constraint product_description_length check (description is null or char_length(description)<=1000);

-- Append columns without changing existing view column order or invoker RLS.
do $$ declare v text; source text; begin
 foreach v in array array['v_product_stock','v_product_catalog'] loop
  source:=rtrim(pg_get_viewdef(('public.'||v)::regclass,true), E'; \n');
  execute format('create or replace view public.%I with (security_invoker=true) as select existing.*, p.description from (%s) existing join public.products p on p.id=existing.id',v,source);
 end loop;
end $$;

-- Delegate creation and its access checks; any failure rolls back all writes.
create function public.create_product_with_description(
 p_store uuid,p_name text,p_barcode text default null,p_category uuid default null,p_supplier uuid default null,
 p_cost numeric default 0,p_selling numeric default 0,p_min numeric default 0,p_reorder numeric default 0,
 p_unit text default 'each',p_track_expiry boolean default false,p_description text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid; clean_description text:=nullif(btrim(p_description),'');
begin
 if not app.has_store_access(p_store) then raise exception 'FORBIDDEN';end if;
 perform app.require_module(p_store,array['products','goods_in','goods_out']);
 if char_length(clean_description)>1000 then raise exception 'PRODUCT_DESCRIPTION_TOO_LONG';end if;
 new_id:=public.create_product(p_store,p_name,p_barcode,p_category,p_supplier,p_cost,p_selling,p_min,p_reorder,p_unit,p_track_expiry);
 update public.products set description=clean_description where id=new_id;
 if clean_description is not null then
  perform app.audit('product.description','products',new_id,app.store_business(p_store),p_store,null,jsonb_build_object('description',clean_description));
 end if;
 return new_id;
end $$;
revoke all on function public.create_product_with_description(uuid,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,boolean,text) from public,anon;
grant execute on function public.create_product_with_description(uuid,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,boolean,text) to authenticated;

-- Preserve current barcode and expiry guards while extending the atomic edit.
do $$ declare source text; begin
 source:=pg_get_functiondef('public.save_product_details(uuid,jsonb,date,numeric)'::regprocedure);
 if position('update public.products set name=' in source)=0 then raise exception 'Expected product save implementation';end if;
 source:=replace(source,'update public.products set name=',
 'if char_length(p_values->>''description'')>1000 then raise exception ''PRODUCT_DESCRIPTION_TOO_LONG'';end if;
 update public.products set description=case when p_values ? ''description'' then nullif(btrim(p_values->>''description''),'''') else description end,name=');
 execute source;
 source:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 source:=replace(source,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''product_description_v1'',to_regprocedure(''public.create_product_with_description(uuid,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,boolean,text)'') is not null,');
 execute source;
end $$;
