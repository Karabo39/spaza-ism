-- A scoped manager permission; existing role defaults apply, owners retain access.
insert into public.module_catalog(key,label,minimum_role,parent_key)
values ('warehouse_disable','Disable Warehouse','manager','warehouse');

-- Shared location locks serialize stock/transfer writes with disabling. A waiting
-- write rechecks the active flag after the disable transaction commits.
create function app.guard_active_warehouse_stock() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.stores%rowtype;
begin
 select * into s from public.stores where id=new.store_id and location_type='warehouse' for share;
 if s.location_type='warehouse' and not s.is_active then raise exception 'WAREHOUSE_DISABLED';end if;
 return new;
end $$;
revoke all on function app.guard_active_warehouse_stock() from public,anon,authenticated;
create trigger guard_active_warehouse_stock before insert or update on public.stock
for each row execute function app.guard_active_warehouse_stock();

create function app.guard_active_warehouse_transfer() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.stores%rowtype;
begin
 for s in select * from public.stores where id in(new.source_id,new.destination_id) and location_type='warehouse' order by id for share loop
  if s.location_type='warehouse' and not s.is_active then raise exception 'WAREHOUSE_DISABLED';end if;
 end loop;
 return new;
end $$;
revoke all on function app.guard_active_warehouse_transfer() from public,anon,authenticated;
create trigger guard_active_warehouse_transfer before insert or update on public.stock_transfers
for each row execute function app.guard_active_warehouse_transfer();

create function public.disable_warehouse(p_store uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.stores%rowtype;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN';end if;
 perform app.require_module(p_store,array['warehouse_disable']);
 select * into s from public.stores where id=p_store for update;
 if not found or s.location_type<>'warehouse' then raise exception 'FORBIDDEN';end if;
 -- Recheck permission after obtaining the lock.
 perform app.require_module(p_store,array['warehouse_disable']);
 if exists(select 1 from public.stock where store_id=p_store and quantity<>0) then raise exception 'WAREHOUSE_HAS_STOCK';end if;
 if exists(select 1 from public.stock_transfers where (source_id=p_store or destination_id=p_store) and status in ('DRAFT','SUBMITTED','DISPATCHED')) then raise exception 'WAREHOUSE_HAS_OPEN_TRANSFERS';end if;
 update public.warehouse_sync_settings set enabled=false,updated_at=now() where warehouse_id=p_store;
 update public.stores set is_active=false where id=p_store;
 perform app.audit('warehouse.disable','stores',p_store,s.business_id,p_store,to_jsonb(s),jsonb_build_object('is_active',false));
end $$;
revoke all on function public.disable_warehouse(uuid) from public,anon;
grant execute on function public.disable_warehouse(uuid) to authenticated;

do $$ declare src text;begin
 src:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 src:=replace(src,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''warehouse_disable_v1'',to_regprocedure(''public.disable_warehouse(uuid)'') is not null,');
 execute src;
end $$;
