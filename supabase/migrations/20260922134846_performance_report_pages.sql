create index audit_business_date_id on public.audit_logs(business_id,created_at desc,id desc);
create index movements_store_date_id on public.stock_movements(store_id,created_at desc,id desc);
create index sales_store_date_id on public.goods_out(store_id,created_at desc,id desc);

create function public.activity_page(p_kind text,p_scope uuid,p_from timestamptz default null,
 p_to timestamptz default null,p_after jsonb default null,p_limit integer default 50,p_details boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r record; item jsonb; result jsonb:='[]'; last_row jsonb; next_row jsonb; n integer:=0;
 page_size integer:=greatest(1,least(coalesce(p_limit,50),200));
begin
 if p_kind not in ('audit','movements','sales') then raise exception 'INVALID_REPORT'; end if;
 if p_kind<>'audit' and not app.has_module(p_scope,'reports') then raise exception 'FORBIDDEN'; end if;
 for r in
  select id,created_at from (
   select id,created_at from public.audit_logs where p_kind='audit' and business_id=p_scope
   union all select id,created_at from public.stock_movements where p_kind='movements' and store_id=p_scope
   union all select id,created_at from public.goods_out where p_kind='sales' and store_id=p_scope
  ) base where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
    and (p_after is null or (created_at,id)<((p_after->>'created_at')::timestamptz,(p_after->>'id')::uuid))
  order by created_at desc,id desc limit page_size+1
 loop
  if n=page_size then next_row:=last_row; exit; end if;
  if p_kind='audit' then
   if p_details then select to_jsonb(v) into item from public.v_audit_activity v where id=r.id limit 1;
   else select jsonb_build_object('id',a.id,'created_at',a.created_at,'action',a.action,'actor_id',a.actor_id,
    'actor_name',p.full_name,'location_name',s.name,'entity_type',a.entity_type,'entity_id',a.entity_id)
    into item from public.audit_logs a left join public.profiles p on p.id=a.actor_id
    left join public.stores s on s.id=a.store_id where a.id=r.id; end if;
  elsif p_kind='movements' then
   select jsonb_build_object('id',m.id,'created_at',m.created_at,'movement_type',m.movement_type,
    'stock_type',m.stock_type,'quantity_delta',m.quantity_delta,'quantity_before',m.quantity_before,
    'quantity_after',m.quantity_after,'reason',m.reason,'products',jsonb_build_object('name',p.name,'sku',p.sku,'bulk_parent_id',p.bulk_parent_id))
    into item from public.stock_movements m left join public.products p on p.id=m.product_id where m.id=r.id;
  else
   select jsonb_build_object('id',g.id,'created_at',g.created_at,'sale_type',g.sale_type,'total_amount',g.total_amount,
    'credit_override',g.credit_override,'authorized_by',g.authorized_by,
    'customer_name',c.name,'cashier',coalesce(rec.snapshot->>'cashier',staff.full_name,'User unavailable'),
    'approver',approver.full_name,'payments',rec.snapshot->'payments',
    'items_count',(select count(*) from public.goods_out_items where goods_out_id=g.id))
    into item from public.goods_out g left join public.customers c on c.id=g.customer_id
    left join public.profiles staff on staff.id=g.performed_by left join public.profiles approver on approver.id=g.authorized_by
    left join public.sale_receipts rec on rec.sale_id=g.id where g.id=r.id;
  end if;
  result:=result||jsonb_build_array(item); n:=n+1;
  last_row:=jsonb_build_object('created_at',r.created_at,'id',r.id);
 end loop;
 return jsonb_build_object('rows',result,'next',next_row);
end $$;
revoke all on function public.activity_page(text,uuid,timestamptz,timestamptz,jsonb,integer,boolean) from public,anon;
grant execute on function public.activity_page(text,uuid,timestamptz,timestamptz,jsonb,integer,boolean) to authenticated;

-- Preserve the existing compatibility contract and add this release's required APIs.
do $$ declare definition text; begin
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into definition;
 definition:=replace(definition,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''performance_v1'',to_regprocedure(''public.session_bootstrap()'') is not null and to_regprocedure(''public.catalog_page(uuid[],text,text,boolean,boolean,text,jsonb,integer)'') is not null and to_regprocedure(''public.activity_page(text,uuid,timestamptz,timestamptz,jsonb,integer,boolean)'') is not null,');
 -- Earlier definitions may have whitespace between JSON arguments.
 if definition not like '%performance_v1%' then
  definition:=regexp_replace(definition,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''performance_v1'',true,');
 end if;
 if definition not like '%performance_v1%' then raise exception 'Release contract pattern changed'; end if;
 execute definition;
end $$;
