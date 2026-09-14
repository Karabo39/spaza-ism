-- Warehouse submission dispatches atomically; store receipt remains separate.
alter table public.stock_transfers add column draft_version bigint not null default 0, add column draft_request uuid, add column draft_payload jsonb;
alter table public.stock_transfer_items add column selling_price numeric(14,2);
create function app.warehouse_destination_product(p_source uuid,p_destination uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare src public.products%rowtype; dest public.stores%rowtype; matches uuid[];
begin
 select * into src from public.products where id=p_source and is_active;
 select * into dest from public.stores where id=p_destination and is_active and location_type='store';
 if src.id is null or dest.id is null or src.business_id<>dest.business_id or not exists(select 1 from public.stores where id=src.store_id and location_type='warehouse' and is_active and currency=dest.currency) then raise exception 'INVALID_LOCATION_OR_CURRENCY';end if;
 select array_agg(distinct id) into matches from (
 select p.id from public.products p where p.store_id=dest.id and p.is_active and src.sku is not null and p.sku=src.sku
 union select p.id from app.warehouse_product_links l join public.products p on p.id=l.source_product_id where l.warehouse_id=src.store_id and l.product_id=src.id and p.store_id=dest.id and p.is_active
 union select p.id from public.product_barcodes b join public.product_barcodes d on d.barcode=b.barcode and d.is_active join public.products p on p.id=d.product_id where b.product_id=src.id and b.is_active and p.store_id=dest.id and p.is_active) m;
 if coalesce(cardinality(matches),0)<>1 then raise exception 'DESTINATION_PRODUCT_MATCH_REQUIRED';end if;
 if exists(select 1 from public.products where id=matches[1] and (unit<>src.unit or track_expiry<>src.track_expiry)) then raise exception 'PRODUCT_UNITS_MISMATCH';end if;
 return matches[1];
end $$;
revoke all on function app.warehouse_destination_product(uuid,uuid) from public,anon,authenticated;
create function public.match_warehouse_product(p_source uuid,p_destination uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare source_store uuid; target uuid;
begin
 select store_id into source_store from public.products where id=p_source;
 perform app.require_module(source_store,array['operations_transfer_create']);perform app.require_module(p_destination,array['operations']);
 target:=app.warehouse_destination_product(p_source,p_destination);
 return (select to_jsonb(p) from public.v_product_catalog p where id=target);
end $$;
revoke all on function public.match_warehouse_product(uuid,uuid) from public,anon;
grant execute on function public.match_warehouse_product(uuid,uuid) to authenticated;
create function public.save_warehouse_transfer(p_source uuid,p_destination uuid,p_items jsonb,p_request uuid,p_note text default null,p_transfer uuid default null,p_expected bigint default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.stock_transfers%rowtype; r jsonb; target uuid; rows jsonb:='[]'; payload jsonb; q numeric; old_items jsonb;
begin
 perform app.require_module(p_source,array['operations_transfer_create']);perform app.require_module(p_destination,array['operations']);
 if p_request is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'NO_ITEMS';end if;
 payload:=jsonb_build_object('items',p_items,'note',p_note,'source',p_source,'destination',p_destination);
 if p_transfer is not null then
 select * into t from public.stock_transfers where id=p_transfer for update;
 perform app.require_module(t.source_id,array['operations_transfer_modify']);
 if t.id is null or t.source_id<>p_source or t.destination_id<>p_destination or t.status<>'DRAFT' then raise exception 'INVALID_TRANSFER_STATE';end if;
 if t.draft_request=p_request then if t.draft_payload<>payload then raise exception 'REQUEST_CONFLICT';end if;return t.id;end if;
 if p_expected is null or t.draft_version<>p_expected then raise exception 'DRAFT_CHANGED_RELOAD';end if;
 end if;
 for r in select value from jsonb_array_elements(p_items) loop
 target:=app.warehouse_destination_product((r->>'source_product_id')::uuid,p_destination);
 if not exists(select 1 from public.products where id=(r->>'source_product_id')::uuid and store_id=p_source) then raise exception 'FORBIDDEN';end if;
 q:=(r->>'quantity')::numeric;if q is null or q<=0 or q>=1e10 or q<>round(q,3) then raise exception 'INVALID_QUANTITY';end if;
 rows:=rows||jsonb_build_array(jsonb_build_object('source_product_id',r->>'source_product_id','destination_product_id',target,'quantity',q));
 end loop;
 if p_transfer is null then return app_private.create_stock_transfer(p_source,p_destination,rows,p_request,p_note);end if;
 select jsonb_agg(to_jsonb(i)) into old_items from public.stock_transfer_items i where transfer_id=t.id;
 delete from public.stock_transfer_items where transfer_id=t.id;
 insert into public.stock_transfer_items(transfer_id,source_product_id,destination_product_id,source_name,destination_name,quantity,unit_cost)
 select t.id,p.id,d.id,p.name,d.name,(entry.value->>'quantity')::numeric,p.cost_price from jsonb_array_elements(rows) entry(value) join public.products p on p.id=(entry.value->>'source_product_id')::uuid join public.products d on d.id=(entry.value->>'destination_product_id')::uuid;
 update public.stock_transfers set note=p_note,draft_version=draft_version+1,draft_request=p_request,draft_payload=payload where id=t.id;
 perform app.audit('transfer.edit','stock_transfers',t.id,t.business_id,t.source_id,jsonb_build_object('version',t.draft_version,'items',old_items,'note',t.note),jsonb_build_object('version',t.draft_version+1,'items',rows,'note',p_note));
 return t.id;
end $$;
revoke all on function public.save_warehouse_transfer(uuid,uuid,jsonb,uuid,text,uuid,bigint) from public,anon;
grant execute on function public.save_warehouse_transfer(uuid,uuid,jsonb,uuid,text,uuid,bigint) to authenticated;
create function public.submit_warehouse_transfer(p_transfer uuid) returns text
language plpgsql security definer set search_path='' as $$
declare t public.stock_transfers%rowtype; i record;
begin
 select * into t from public.stock_transfers where id=p_transfer for update;
 perform app.require_module(t.source_id,array['operations_transfer_modify']);perform app.require_module(t.source_id,array['operations_transfer_dispatch']);perform app.require_module(t.destination_id,array['operations']);
 if not exists(select 1 from public.stores where id=t.source_id and location_type='warehouse') or not exists(select 1 from public.stores where id=t.destination_id and location_type='store') then raise exception 'INVALID_LOCATION';end if;
 if t.status in ('DISPATCHED','RECEIVED') then return t.status;end if;
 if t.status not in ('DRAFT','SUBMITTED') then raise exception 'INVALID_TRANSFER_STATE';end if;
 for i in select * from public.stock_transfer_items where transfer_id=t.id loop
 if app.warehouse_destination_product(i.source_product_id,t.destination_id)<>i.destination_product_id then raise exception 'DESTINATION_PRODUCT_MATCH_REQUIRED';end if;
 end loop;
 update public.stock_transfer_items line set unit_cost=p.cost_price,selling_price=p.selling_price from public.products p where line.transfer_id=t.id and p.id=line.source_product_id;
 if t.status='DRAFT' then perform app_private.process_stock_transfer(t.id,'submit',null);end if;
 return app_private.process_stock_transfer(t.id,'dispatch',null);
end $$;
revoke all on function public.submit_warehouse_transfer(uuid) from public,anon;
grant execute on function public.submit_warehouse_transfer(uuid) to authenticated;
create function public.receive_warehouse_transfer(p_transfer uuid,p_store uuid) returns text
language plpgsql security definer set search_path='' as $$
declare t public.stock_transfers%rowtype; i record;
begin
 select * into t from public.stock_transfers where id=p_transfer for update;
 if t.id is null or not exists(select 1 from public.stores where id=t.source_id and location_type='warehouse') or t.destination_id<>p_store or not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'FORBIDDEN';end if;
 perform app.require_module(p_store,array['goods_in_receive_transfer']);
 if (select currency from public.stores where id=t.source_id) is distinct from (select currency from public.stores where id=p_store) then raise exception 'INVALID_LOCATION_OR_CURRENCY';end if;
 if t.status='RECEIVED' then return t.status;end if;
 if exists(select 1 from public.stock_transfer_items line join public.products src on src.id=line.source_product_id join public.products dst on dst.id=line.destination_product_id where line.transfer_id=t.id and (src.unit<>dst.unit or src.track_expiry<>dst.track_expiry)) then raise exception 'PRODUCT_UNITS_MISMATCH';end if;
 perform app_private.process_stock_transfer(t.id,'receive',null);
 for i in select * from public.stock_transfer_items where transfer_id=t.id order by destination_product_id loop
 update public.products set cost_price=i.unit_cost,selling_price=coalesce(i.selling_price,selling_price) where id=i.destination_product_id and store_id=p_store;
 end loop;
 return 'RECEIVED';
end $$;
revoke all on function public.receive_warehouse_transfer(uuid,uuid) from public,anon;
grant execute on function public.receive_warehouse_transfer(uuid,uuid) to authenticated;
create function public.warehouse_receipts(p_store uuid) returns setof public.stock_transfers
language plpgsql stable security definer set search_path='' as $$
begin
 perform app.require_module(p_store,array['goods_in_receive_transfer']);
 return query select t.* from public.stock_transfers t join public.stores s on s.id=t.source_id where t.destination_id=p_store and s.location_type='warehouse' and t.status in ('DISPATCHED','RECEIVED') order by (t.status='DISPATCHED') desc,t.created_at desc,t.id limit 200;
end $$;
revoke all on function public.warehouse_receipts(uuid) from public,anon;
grant execute on function public.warehouse_receipts(uuid) to authenticated;
do $$ declare src text;begin
 src:=pg_get_functiondef('public.transfer_detail(uuid)'::regprocedure);
 src:=replace(src,'''source'',(select name', '''version'',t.draft_version,''source_id'',t.source_id,''destination_id'',t.destination_id,''reference'',t.reference,''source'',(select name');
 src:=replace(src,'''id'',i.id,''source_name''','''id'',i.id,''source_product_id'',i.source_product_id,''destination_product_id'',i.destination_product_id,''source_name''');
 execute src;
end $$;

create function public.my_warehouse_transfers(p_business uuid) returns setof public.stock_transfers
language sql stable security definer set search_path='' as $$
 select t.* from public.stock_transfers t join public.stores s on s.id=t.source_id where t.business_id=p_business and t.created_by=auth.uid() and s.location_type='warehouse' and app.can_read_transfer(t.source_id,t.destination_id,t.status) order by t.created_at desc,t.id limit 200;
$$;
revoke all on function public.my_warehouse_transfers(uuid) from public,anon;
grant execute on function public.my_warehouse_transfers(uuid) to authenticated;

do $$ declare src text;begin
 src:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 src:=replace(src,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''warehouse_transfer_workflow_v1'',to_regprocedure(''public.submit_warehouse_transfer(uuid)'') is not null and to_regprocedure(''public.receive_warehouse_transfer(uuid,uuid)'') is not null,');
 execute src;
end $$;
