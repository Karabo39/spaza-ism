-- Retain historical pack identifiers as dependent stock records. New catalogue entries
-- expose one main product, with its linked bulk record managed atomically.
alter table public.products add column tracking_type text not null default 'QUANTITY' check(tracking_type in('QUANTITY','SALES_ONLY'));
alter table public.products add column bulk_parent_id uuid references public.products(id);
alter table public.products add column bulk_enabled boolean not null default false;
create index products_bulk_parent on public.products(bulk_parent_id) where bulk_parent_id is not null;
update public.products p set bulk_parent_id=c.unit_product_id from public.bulk_conversions c where c.pack_product_id=p.id;
update public.products p set bulk_enabled=true where exists(select 1 from public.bulk_conversions c where c.unit_product_id=p.id);
alter table public.products add constraint sales_only_configuration check(tracking_type='QUANTITY' or (not track_expiry and not bulk_enabled and bulk_parent_id is null and min_stock_level=0 and reorder_level=0));

create function app.guard_bulk_parent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.bulk_parent_id is not null then
  if new.bulk_parent_id=new.id or not exists(select 1 from public.products p where p.id=new.bulk_parent_id and p.store_id=new.store_id and p.business_id=new.business_id and p.bulk_parent_id is null and p.tracking_type='QUANTITY') then raise exception 'INVALID_BULK_PARENT';end if;
 end if;
 return new;
end $$;
revoke all on function app.guard_bulk_parent() from public,anon,authenticated;
create trigger guard_bulk_parent before insert or update on public.products for each row execute function app.guard_bulk_parent();

create function app.guard_product_tracking() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.tracking_type is distinct from old.tracking_type then
  if exists(select 1 from public.stock where product_id=new.id and quantity<>0)
   or exists(select 1 from public.stock_batches where product_id=new.id and quantity<>0)
   or exists(select 1 from public.goods_out_items where product_id=new.id)
   or exists(select 1 from public.sales_invoice_items where product_id=new.id)
   or exists(select 1 from public.sales_order_items where product_id=new.id)
   or exists(select 1 from public.stock_transfer_items where source_product_id=new.id or destination_product_id=new.id)
   or exists(select 1 from public.stock_take_items i join public.stock_takes t on t.id=i.stock_take_id where i.product_id=new.id and t.status='IN_PROGRESS')
   or exists(select 1 from public.bulk_conversions where pack_product_id=new.id or unit_product_id=new.id)
   then raise exception 'TRACKING_CHANGE_HAS_HISTORY_OR_STOCK';end if;
 end if;
 return new;
end $$;
revoke all on function app.guard_product_tracking() from public,anon,authenticated;
create trigger guard_product_tracking before update on public.products for each row execute function app.guard_product_tracking();

create function app.configure_product_stock(p_product uuid,p_values jsonb) returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; pack uuid; ratio integer; enabled boolean; tracking text; bulk_label text;
begin
 select * into p from public.products where id=p_product for update;
 if not found or not app.has_store_role(p.store_id,'manager') then raise exception 'FORBIDDEN';end if;
 perform app.require_module(p.store_id,array['products']);
 if p.bulk_parent_id is not null then raise exception 'EDIT_MAIN_PRODUCT';end if;
 tracking:=coalesce(p_values->>'tracking_type',p.tracking_type);
 enabled:=coalesce((p_values->>'bulk_enabled')::boolean,p.bulk_enabled);
 if tracking='SALES_ONLY' and enabled then raise exception 'SALES_ONLY_NO_BULK';end if;
 update public.products set tracking_type=tracking,bulk_enabled=enabled,
  track_expiry=case when tracking='SALES_ONLY' then false else track_expiry end,
  min_stock_level=case when tracking='SALES_ONLY' then 0 else min_stock_level end,
  reorder_level=case when tracking='SALES_ONLY' then 0 else reorder_level end where id=p.id;
 select pack_product_id into pack from public.bulk_conversions where unit_product_id=p.id order by updated_at,id limit 1 for update;
 if enabled then
  ratio:=coalesce((p_values->>'units_per_pack')::integer,(select units_per_pack from public.bulk_conversions where pack_product_id=pack),6);
  bulk_label:=coalesce(nullif(btrim(p_values->>'bulk_unit'),''),(select unit from public.products where id=pack),'case');
  if ratio not between 1 and 100000 or length(bulk_label)>40 then raise exception 'INVALID_CONVERSION';end if;
  if pack is null then
   pack:=app_private.create_product(p_store:=p.store_id,p_name:=p.name||' – Bulk Stock',p_cost:=p.cost_price*ratio,p_selling:=p.selling_price*ratio,p_unit:=bulk_label,p_track_expiry:=p.track_expiry);
   update public.products set bulk_parent_id=p.id where id=pack;
  else
   update public.products set is_active=p.is_active,unit=bulk_label where id=pack;
  end if;
  perform app_private.set_bulk_conversion(pack,p.id,ratio);
 else
  if exists(select 1 from public.products b join public.stock st on st.product_id=b.id where b.bulk_parent_id=p.id and st.quantity<>0)
   or exists(select 1 from public.stock_transfer_items i join public.stock_transfers t on t.id=i.transfer_id join public.products b on b.id in(i.source_product_id,i.destination_product_id) where b.bulk_parent_id=p.id and t.status in('DRAFT','SUBMITTED','DISPATCHED')) then raise exception 'BULK_STOCK_OR_TRANSFER_REMAINS';end if;
  update public.products set is_active=false where bulk_parent_id=p.id;
 end if;
 perform app.audit('product.stock_configuration','products',p.id,p.business_id,p.store_id,to_jsonb(p),p_values);
end $$;
revoke all on function app.configure_product_stock(uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_product_catalog(p_store uuid, p_name text, p_values jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid;
begin
 perform app.require_module(p_store,array['products']);
 if length(p_values->>'sku')>128 then raise exception 'INVALID_SKU';end if;
 pid:=public.create_product_with_description(p_store:=p_store,p_name:=p_name,p_description:=p_values->>'description',p_barcode:=p_values->>'barcode',p_cost:=coalesce((p_values->>'cost')::numeric,0),p_selling:=coalesce((p_values->>'selling')::numeric,0),p_min:=coalesce((p_values->>'min')::numeric,0),p_reorder:=coalesce((p_values->>'reorder')::numeric,0),p_track_expiry:=coalesce((p_values->>'track_expiry')::boolean,false));
 update public.products set sku=nullif(btrim(p_values->>'sku'),'') where id=pid;
 perform app.configure_product_stock(pid,p_values);
 return pid;
end $function$
;

CREATE OR REPLACE FUNCTION public.save_product_details(p_product uuid, p_values jsonb, p_expiry date DEFAULT NULL::date, p_expected numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.products%rowtype; total numeric; undated numeric; current_barcode text; new_barcode text; barcode_id uuid;
begin
 select * into p from public.products where id=p_product;
 if not found then raise exception 'FORBIDDEN'; end if;
 perform app.require_module(p.store_id,array['products']);
 select quantity into total from public.stock where product_id=p.id and store_id=p.store_id for update;
 select greatest(coalesce(total,0)-coalesce(sum(quantity) filter(where expiry_date is not null),0),0) into undated from public.stock_batches where product_id=p.id and store_id=p.store_id;
 if coalesce((p_values->>'track_expiry')::boolean,false) and undated>0 then
  if p_expiry is null then raise exception 'EXPIRY_REQUIRED'; end if;
  perform public.assign_stock_expiry(p.id,p_expiry,undated,p_expected);
 end if;
 if p_values ? 'barcode' then
  new_barcode:=btrim(p_values->>'barcode');
  select id,barcode into barcode_id,current_barcode from public.product_barcodes where product_id=p.id and is_active order by created_at,id limit 1 for update;
  if current_barcode is distinct from nullif(p_values->>'expected_barcode','') then raise exception 'BARCODE_CHANGED_REFRESH';end if;
  if nullif(new_barcode,'') is null or length(new_barcode)>128 then raise exception 'INVALID_BARCODE';end if;
  if new_barcode is distinct from current_barcode then
   if exists(select 1 from public.product_barcodes where store_id=p.store_id and barcode=new_barcode and is_active) then raise exception 'BARCODE_ALREADY_EXISTS';end if;
   if barcode_id is not null then update public.product_barcodes set is_active=false where id=barcode_id;end if;
   insert into public.product_barcodes(product_id,store_id,barcode) values(p.id,p.store_id,new_barcode);
   perform app.audit('product.barcode','products',p.id,p.business_id,p.store_id,jsonb_build_object('barcode',current_barcode),jsonb_build_object('barcode',new_barcode));
  end if;
 end if;
 if nullif(btrim(p_values->>'name'),'') is null then raise exception 'PRODUCT_NAME_REQUIRED'; end if;
 if char_length(p_values->>'description')>1000 then raise exception 'PRODUCT_DESCRIPTION_TOO_LONG';end if;
 if char_length(p_values->>'sku')>128 then raise exception 'INVALID_SKU';end if;
 update public.products set sku=case when p_values ? 'sku' then nullif(btrim(p_values->>'sku'),'') else sku end,description=case when p_values ? 'description' then nullif(btrim(p_values->>'description'),'') else description end,name=btrim(p_values->>'name'),cost_price=(p_values->>'cost_price')::numeric,
 selling_price=(p_values->>'selling_price')::numeric,min_stock_level=(p_values->>'min_stock_level')::numeric,
 reorder_level=(p_values->>'reorder_level')::numeric,unit=coalesce(nullif(btrim(p_values->>'unit'),''),'each'),
 track_expiry=(p_values->>'track_expiry')::boolean,is_active=(p_values->>'is_active')::boolean where id=p.id;
 perform app.configure_product_stock(p.id,p_values);
 perform app.audit('product.edit','products',p.id,p.business_id,p.store_id,to_jsonb(p),p_values);
end $function$
;

CREATE OR REPLACE FUNCTION app.apply_stock_delta(p_business uuid, p_store uuid, p_product uuid, p_delta numeric, p_type app.movement_type, p_reason text, p_ref_table text, p_ref_id uuid, p_unit_cost numeric DEFAULT NULL::numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare
  v_before numeric(14,3);
  v_after  numeric(14,3);
begin
  perform 1 from public.products where id=p_product and store_id=p_store for share;
  if exists(select 1 from public.products where id=p_product and store_id=p_store and tracking_type='SALES_ONLY') then
   if p_type in('SALE_CASH','SALE_CARD','SALE_CREDIT','RETURN_IN') then return 0;end if;
   raise exception 'SALES_ONLY_NO_STOCK';
  end if;
  -- Ensure a stock row exists, then lock it (serializes concurrent writers).
  insert into public.stock (product_id, store_id, quantity)
  values (p_product, p_store, 0)
  on conflict (product_id, store_id) do nothing;

  select quantity into v_before from public.stock
  where product_id = p_product and store_id = p_store
  for update;

  v_after := v_before + p_delta;
  if v_after < 0 then
    raise exception 'INSUFFICIENT_STOCK: product % has % available, tried to remove %',
      p_product, v_before, -p_delta using errcode = 'check_violation';
  end if;

  update public.stock set quantity = v_after
  where product_id = p_product and store_id = p_store;

  insert into public.stock_movements
    (business_id, store_id, product_id, movement_type, quantity_delta,
     quantity_before, quantity_after, unit_cost, reason, reference_table,
     reference_id, performed_by)
  values (p_business, p_store, p_product, p_type, p_delta, v_before, v_after,
     p_unit_cost, p_reason, p_ref_table, p_ref_id, auth.uid());

  return v_after;
end $function$
;

CREATE OR REPLACE FUNCTION app.put_stock_batches(p_product uuid, p_store uuid, p_batches jsonb, p_multiplier numeric DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
begin
  if exists(select 1 from public.products where id=p_product and tracking_type='SALES_ONLY') then return;end if;
  insert into public.stock_batches(product_id,store_id,quantity,expiry_date,batch_ref)
    select p_product,p_store,(b->>'quantity')::numeric*p_multiplier,(b->>'expiry_date')::date,b->>'batch_ref'
    from jsonb_array_elements(p_batches) b;
end $function$
;

CREATE OR REPLACE FUNCTION app_private.start_stock_take(p_store uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare v_biz uuid; v_st uuid;
begin
  if not app.has_store_access(p_store) then raise exception 'FORBIDDEN'; end if;
  v_biz := app.store_business(p_store);
  insert into public.stock_takes (business_id, store_id, note, started_by)
  values (v_biz, p_store, p_note, auth.uid()) returning id into v_st;

  insert into public.stock_take_items (stock_take_id, product_id, system_qty)
  select v_st, p.id, coalesce(s.quantity, 0)
  from public.products p
  left join public.stock s on s.product_id = p.id and s.store_id = p_store
  where p.store_id = p_store and p.is_active and p.tracking_type='QUANTITY';

  perform app.audit('stock_take.start','stock_take',v_st,v_biz,p_store,null,null);
  return v_st;
end $function$
;

create function app.guard_sales_only_stock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.products where id=new.product_id for share;
 if new.quantity<>0 and exists(select 1 from public.products where id=new.product_id and tracking_type='SALES_ONLY') then raise exception 'SALES_ONLY_NO_STOCK';end if;
 return new;
end $$;
revoke all on function app.guard_sales_only_stock() from public,anon,authenticated;
create trigger guard_sales_only_stock before insert or update on public.stock for each row execute function app.guard_sales_only_stock();
create trigger guard_sales_only_batches before insert or update on public.stock_batches for each row execute function app.guard_sales_only_stock();

CREATE OR REPLACE FUNCTION app.check_bulk_transfer(p_source uuid, p_destination uuid, p_quantity numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare src public.bulk_conversions%rowtype; dst public.bulk_conversions%rowtype; location uuid;
begin
 if exists(select 1 from public.products where id in(p_source,p_destination) and tracking_type='SALES_ONLY') then raise exception 'SALES_ONLY_NO_STOCK';end if;
 for location in select distinct store_id from public.products where id in(p_source,p_destination) order by store_id loop
  perform pg_advisory_xact_lock(hashtextextended(location::text,2010));
 end loop;
 -- Share-lock conversions so a pack cannot change ratio during dispatch/receipt.
 perform 1 from public.bulk_conversions where pack_product_id in(p_source,p_destination) order by pack_product_id for share;
 select * into src from public.bulk_conversions where pack_product_id=p_source;
 select * into dst from public.bulk_conversions where pack_product_id=p_destination;
 if (src.id is null)<>(dst.id is null) or src.units_per_pack<>dst.units_per_pack then raise exception 'BULK_TRANSFER_MISMATCH';end if;
 if src.id is not null and p_quantity<>trunc(p_quantity) then raise exception 'WHOLE_PACKS_REQUIRED';end if;
end $function$
;

create function app.link_bulk_parent() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.products where id in(new.pack_product_id,new.unit_product_id) and tracking_type='SALES_ONLY') then raise exception 'SALES_ONLY_NO_BULK';end if;
 update public.products set bulk_parent_id=new.unit_product_id where id=new.pack_product_id;
 update public.products set bulk_enabled=true where id=new.unit_product_id;
 return new;
end $$;
revoke all on function app.link_bulk_parent() from public,anon,authenticated;
create trigger link_bulk_parent after insert or update on public.bulk_conversions for each row execute function app.link_bulk_parent();

create or replace view public.v_product_stock with(security_invoker=true) as select c.*, p.tracking_type,p.bulk_parent_id,p.bulk_enabled,
 coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'conversion_id',bc.id,'name',b.name,'unit',b.unit,'units_per_pack',bc.units_per_pack,'quantity',coalesce(st.quantity,0),'cost_price',b.cost_price,'selling_price',b.selling_price) order by bc.updated_at,bc.id) from public.bulk_conversions bc join public.products b on b.id=bc.pack_product_id left join public.stock st on st.product_id=b.id and st.store_id=b.store_id where bc.unit_product_id=p.id and b.is_active),'[]'::jsonb) as bulk_options
 from ( SELECT existing.id,
    existing.business_id,
    existing.store_id,
    existing.name,
    existing.sku,
    existing.unit,
    existing.cost_price,
    existing.selling_price,
    existing.min_stock_level,
    existing.reorder_level,
    existing.track_expiry,
    existing.is_active,
    existing.category_id,
    existing.default_supplier_id,
    existing.quantity,
    existing.stock_value,
    existing.retail_value,
    existing.category_name,
    existing.supplier_name,
    case when p.tracking_type='SALES_ONLY' then 'not_tracked' else existing.stock_status end as stock_status,
    existing.suggested_reorder,
    p.description
   FROM (( SELECT p_1.id,
            p_1.business_id,
            p_1.store_id,
            p_1.name,
            p_1.sku,
            p_1.unit,
            p_1.cost_price,
            p_1.selling_price,
            p_1.min_stock_level,
            p_1.reorder_level,
            p_1.track_expiry,
            p_1.is_active,
            p_1.category_id,
            p_1.default_supplier_id,
            COALESCE(s.quantity, (0)::numeric) AS quantity,
            round((COALESCE(s.quantity, (0)::numeric) * p_1.cost_price), 2) AS stock_value,
            round((COALESCE(s.quantity, (0)::numeric) * p_1.selling_price), 2) AS retail_value,
            c.name AS category_name,
            sup.name AS supplier_name,
                CASE
                    WHEN (COALESCE(s.quantity, (0)::numeric) <= (0)::numeric) THEN 'out'::text
                    WHEN (COALESCE(s.quantity, (0)::numeric) <= p_1.min_stock_level) THEN 'low'::text
                    WHEN (COALESCE(s.quantity, (0)::numeric) <= p_1.reorder_level) THEN 'reorder'::text
                    ELSE 'ok'::text
                END AS stock_status,
            GREATEST((p_1.reorder_level - COALESCE(s.quantity, (0)::numeric)), (0)::numeric) AS suggested_reorder
           FROM (((products p_1
             LEFT JOIN stock s ON (((s.product_id = p_1.id) AND (s.store_id = p_1.store_id))))
             LEFT JOIN categories c ON ((c.id = p_1.category_id)))
             LEFT JOIN suppliers sup ON ((sup.id = p_1.default_supplier_id)))) existing
     JOIN products p ON ((p.id = existing.id)))) c join public.products p on p.id=c.id;

create or replace view public.v_product_catalog with(security_invoker=true) as select c.*, p.tracking_type,p.bulk_parent_id,p.bulk_enabled,
 coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'conversion_id',bc.id,'name',b.name,'unit',b.unit,'units_per_pack',bc.units_per_pack,'quantity',coalesce(st.quantity,0),'cost_price',b.cost_price,'selling_price',b.selling_price) order by bc.updated_at,bc.id) from public.bulk_conversions bc join public.products b on b.id=bc.pack_product_id left join public.stock st on st.product_id=b.id and st.store_id=b.store_id where bc.unit_product_id=p.id and b.is_active),'[]'::jsonb) as bulk_options
 from ( SELECT id,
    business_id,
    store_id,
    name,
    sku,
    unit,
    cost_price,
    selling_price,
    min_stock_level,
    reorder_level,
    track_expiry,
    is_active,
    category_id,
    default_supplier_id,
    quantity,
    stock_value,
    retail_value,
    category_name,
    supplier_name,
    stock_status,
    suggested_reorder,
    barcodes,
    search_text,
    nearest_expiry,
    expired_quantity,
    undated_quantity,
    sellable_quantity,
    description,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM bulk_conversions b
              WHERE ((b.pack_product_id = c.id) AND (b.store_id = c.store_id)))) THEN 'Bulk Stock'::text
            ELSE 'Individual'::text
        END AS item_type
   FROM ( SELECT existing.id,
            existing.business_id,
            existing.store_id,
            existing.name,
            existing.sku,
            existing.unit,
            existing.cost_price,
            existing.selling_price,
            existing.min_stock_level,
            existing.reorder_level,
            existing.track_expiry,
            existing.is_active,
            existing.category_id,
            existing.default_supplier_id,
            existing.quantity,
            existing.stock_value,
            existing.retail_value,
            existing.category_name,
            existing.supplier_name,
            existing.stock_status,
            existing.suggested_reorder,
            existing.barcodes,
            ((existing.search_text || ' '::text) || COALESCE(existing.sku, ''::text)) AS search_text,
            existing.nearest_expiry,
            existing.expired_quantity,
            existing.undated_quantity,
            existing.sellable_quantity,
            p.description
           FROM (( SELECT v.id,
                    v.business_id,
                    v.store_id,
                    v.name,
                    v.sku,
                    v.unit,
                    v.cost_price,
                    v.selling_price,
                    v.min_stock_level,
                    v.reorder_level,
                    v.track_expiry,
                    v.is_active,
                    v.category_id,
                    v.default_supplier_id,
                    v.quantity,
                    v.stock_value,
                    v.retail_value,
                    v.category_name,
                    v.supplier_name,
                    v.stock_status,
                    v.suggested_reorder,
                    COALESCE(b.barcodes, ''::text) AS barcodes,
                    ((COALESCE(b.barcodes, ''::text) || ' '::text) || v.name) AS search_text,
                    x.nearest_expiry,
                    COALESCE(x.expired_quantity, (0)::numeric) AS expired_quantity,
                    GREATEST((v.quantity - COALESCE(x.dated_quantity, (0)::numeric)), (0)::numeric) AS undated_quantity,
                        CASE
                            WHEN v.track_expiry THEN LEAST(v.quantity, COALESCE(x.sellable_quantity, (0)::numeric))
                            ELSE v.quantity
                        END AS sellable_quantity
                   FROM ((v_product_stock v
                     LEFT JOIN LATERAL ( SELECT string_agg(product_barcodes.barcode, ', '::text ORDER BY product_barcodes.barcode) AS barcodes
                           FROM product_barcodes
                          WHERE ((product_barcodes.product_id = v.id) AND product_barcodes.is_active)) b ON (true))
                     LEFT JOIN LATERAL ( SELECT min(stock_batches.expiry_date) FILTER (WHERE (stock_batches.quantity > (0)::numeric)) AS nearest_expiry,
                            sum(stock_batches.quantity) FILTER (WHERE (stock_batches.expiry_date IS NOT NULL)) AS dated_quantity,
                            sum(stock_batches.quantity) FILTER (WHERE (stock_batches.expiry_date < ((now() AT TIME ZONE 'Africa/Johannesburg'::text))::date)) AS expired_quantity,
                            sum(stock_batches.quantity) FILTER (WHERE (stock_batches.expiry_date >= ((now() AT TIME ZONE 'Africa/Johannesburg'::text))::date)) AS sellable_quantity
                           FROM stock_batches
                          WHERE ((stock_batches.product_id = v.id) AND (stock_batches.store_id = v.store_id))) x ON (true))) existing
             JOIN products p ON ((p.id = existing.id)))) c) c join public.products p on p.id=c.id;

do $$ declare src text;begin
 src:=pg_get_functiondef('public.app_schema_status()'::regprocedure);
 src:=replace(src,'''capabilities'',jsonb_build_object(','''capabilities'',jsonb_build_object(''product_stock_tracking_v1'',true,');
 execute src;
end $$;

create function public.quantity_sales_report(p_store uuid,p_from date default null,p_to date default null,p_product uuid default null,p_cashier uuid default null,p_tracking text default null)
returns table(product_id uuid,name text,tracking_type text,sold_qty numeric,returned_qty numeric,net_qty numeric,revenue numeric) language plpgsql stable security definer set search_path='' as $$
begin
 perform app.require_module(p_store,array['reports']);
 if p_tracking is not null and p_tracking not in('QUANTITY','SALES_ONLY') then raise exception 'INVALID_TRACKING_TYPE';end if;
 if p_from>p_to then raise exception 'INVALID_DATE_RANGE';end if;
 return query with activity as (
  select li.product_id,li.quantity sold,0::numeric returned,li.line_total amount,g.performed_by cashier,g.created_at occurred from public.goods_out_items li join public.goods_out g on g.id=li.goods_out_id where g.store_id=p_store
  union all select li.product_id,li.quantity,0::numeric,li.net_total,i.goods_issued_by,i.goods_issued_at from public.sales_invoice_items li join public.sales_invoices i on i.id=li.invoice_id where i.store_id=p_store and i.goods_issued_at is not null
  union all select li.product_id,0::numeric,li.quantity,-li.amount,coalesce(g.performed_by,i.goods_issued_by),r.processed_at from public.goods_return_items li join public.goods_returns r on r.id=li.return_id left join public.goods_out g on g.id=r.sale_id left join public.sales_invoices i on i.id=r.invoice_id where r.store_id=p_store and r.status='APPROVED'
 ), filtered as (select a.* from activity a where (p_from is null or a.occurred >= (p_from::timestamp at time zone 'Africa/Johannesburg')) and (p_to is null or a.occurred < ((p_to+1)::timestamp at time zone 'Africa/Johannesburg')) and (p_cashier is null or a.cashier=p_cashier))
 select p.id,p.name,p.tracking_type,coalesce(sum(a.sold),0),coalesce(sum(a.returned),0),coalesce(sum(a.sold-a.returned),0),coalesce(sum(a.amount),0)
 from public.products p left join filtered a on a.product_id=p.id where p.store_id=p_store and p.bulk_parent_id is null and (p_product is null or p.id=p_product) and (p_tracking is null or p.tracking_type=p_tracking)
 group by p.id,p.name,p.tracking_type order by p.name,p.id;
end $$;
revoke all on function public.quantity_sales_report(uuid,date,date,uuid,uuid,text) from public,anon;
grant execute on function public.quantity_sales_report(uuid,date,date,uuid,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION app.warehouse_destination_product(p_source uuid, p_destination uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare src public.products%rowtype; dest public.stores%rowtype; matches uuid[]; parent_target uuid;
begin
 select * into src from public.products where id=p_source and is_active;
 select * into dest from public.stores where id=p_destination and is_active and location_type='store';
 if src.id is null or dest.id is null or src.business_id<>dest.business_id or not exists(select 1 from public.stores where id=src.store_id and location_type='warehouse' and is_active and currency=dest.currency) then raise exception 'INVALID_LOCATION_OR_CURRENCY';end if;
 if src.bulk_parent_id is not null then
  parent_target:=app.warehouse_destination_product(src.bulk_parent_id,p_destination);
  select array_agg(b.pack_product_id) into matches from public.bulk_conversions b join public.products p on p.id=b.pack_product_id where b.unit_product_id=parent_target and p.is_active and b.units_per_pack=(select units_per_pack from public.bulk_conversions where pack_product_id=src.id);
  if coalesce(cardinality(matches),0)=0 and exists(select 1 from public.bulk_conversions where unit_product_id=parent_target) then raise exception 'BULK_TRANSFER_MISMATCH';end if;
  if coalesce(cardinality(matches),0)<>1 then raise exception 'DESTINATION_BULK_CONFIGURATION_REQUIRED';end if;
  return matches[1];
 end if;
 select array_agg(distinct id) into matches from (
 select p.id from public.products p where p.store_id=dest.id and p.is_active and src.sku is not null and p.sku=src.sku
 union select p.id from app.warehouse_product_links l join public.products p on p.id=l.source_product_id where l.warehouse_id=src.store_id and l.product_id=src.id and p.store_id=dest.id and p.is_active
 union select p.id from public.product_barcodes b join public.product_barcodes d on d.barcode=b.barcode and d.is_active join public.products p on p.id=d.product_id where b.product_id=src.id and b.is_active and p.store_id=dest.id and p.is_active) m;
 if coalesce(cardinality(matches),0)<>1 then raise exception 'DESTINATION_PRODUCT_MATCH_REQUIRED';end if;
 if exists(select 1 from public.products where id=matches[1] and (unit<>src.unit or track_expiry<>src.track_expiry)) then raise exception 'PRODUCT_UNITS_MISMATCH';end if;
 return matches[1];
end $function$
;

CREATE OR REPLACE FUNCTION app.sync_warehouse_catalog(p_warehouse uuid, p_preferred uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare biz uuid; rows jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text,1409));
 select business_id into biz from public.stores where id=p_warehouse and location_type='warehouse' and is_active;
 if p_preferred is not null and not exists(select 1 from public.stores where id=p_preferred and business_id=biz and location_type='store' and is_active) then raise exception 'INVALID_SOURCE_STORE';end if;
 if (select count(*) from public.products p join public.stores s on s.id=p.store_id where p.business_id=biz and p.is_active and p.bulk_parent_id is null and p.tracking_type='QUANTITY' and s.is_active and s.location_type='store')>10000 then raise exception 'CATALOG_TOO_LARGE_USE_TEMPLATE';end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('currency',s.currency,'barcodes',(select coalesce(jsonb_agg(barcode),'[]') from public.product_barcodes where product_id=p.id and is_active)) order by (p.store_id=p_preferred) desc nulls last,p.updated_at desc,p.id),'[]') into rows
 from public.products p join public.stores s on s.id=p.store_id where p.business_id=biz and p.is_active and p.bulk_parent_id is null and p.tracking_type='QUANTITY' and s.is_active and s.location_type='store';
 return app.merge_warehouse_catalog(p_warehouse,rows,p_actor);
end $function$
;

CREATE OR REPLACE FUNCTION public.stock_export(p_store uuid, p_status text DEFAULT 'all'::text, p_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare result jsonb; n integer;
begin
 perform app.require_module(p_store,array['check_stock']);
 if p_status is null or p_status not in ('all','ok','low','out','reorder','inactive') or length(p_search)>200 then raise exception 'INVALID_FILTER'; end if;
 select count(*),coalesce(jsonb_agg(to_jsonb(s) order by s.name,s.id),'[]'::jsonb) into n,result from
 (select id,name,category_name,tracking_type,quantity,unit,stock_status,is_active,cost_price,selling_price,stock_value from public.v_product_stock
 where store_id=p_store and is_active=(p_status<>'inactive') and name ilike '%'||coalesce(p_search,'')||'%'
 and (p_status in ('all','inactive') or stock_status=p_status) order by name,id limit 5001) s;
 if n>5000 then raise exception 'EXPORT_TOO_LARGE'; end if;
 return result;
end $function$
;

-- Cashiers see and submit their own shifts; managers retain store-wide review.
alter policy cash_up_read on public.cash_ups using(app.has_module(store_id,'cash_up') and (created_by=auth.uid() or app.has_store_role(store_id,'manager')));
alter policy drawer_read on public.cash_drawer_movements using(app.has_module(store_id,'cash_up') and app.has_store_role(store_id,'manager'));

CREATE OR REPLACE FUNCTION app.cash_shift_summary(p_store uuid, p_day date, p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype; source jsonb; history jsonb; handover public.cash_ups%rowtype;
begin
 perform app.require_module(p_store,array['cash_up']);
 if p_day is null then raise exception 'INVALID_DATE'; end if;
 if p_shift is null and not app.has_store_role(p_store,'manager') and p_day=(now() at time zone 'Africa/Johannesburg')::date then
  select * into handover from public.cash_ups where store_id=p_store and business_date=p_day order by shift_number desc limit 1;
  if handover.status='APPROVED' and handover.created_by<>auth.uid() then
   return jsonb_build_object('handover',jsonb_build_object('id',handover.id,'counted',(select counted from public.cash_up_submissions where id=handover.latest_submission)));
  end if;
 end if;

 select * into c from public.cash_ups where store_id=p_store and business_date=p_day and (p_shift is null or id=p_shift) and (created_by=auth.uid() or app.has_store_role(p_store,'manager')) order by shift_number desc limit 1;
 if p_shift is not null and c.id is null then raise exception 'FORBIDDEN';end if;
 if c.id is null and not app.has_store_role(p_store,'manager') and exists(select 1 from public.cash_ups where store_id=p_store and business_date=p_day) then raise exception 'SHIFT_BELONGS_TO_OTHER_USER';end if;
 source:=case when c.id is null then app.cash_sources(p_store,p_day) else app.cash_shift_sources(c.id) end;
 select coalesce(jsonb_agg(to_jsonb(s)-'request_payload'-'request_id'-'sources' || jsonb_build_object('created_by_name',coalesce(p.full_name,'Team member'),
  'reviews',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('created_by_name',coalesce(rp.full_name,'Manager')) order by r.created_at),'[]'::jsonb) from public.cash_up_reviews r left join public.profiles rp on rp.id=r.created_by where r.submission_id=s.id)) order by s.revision desc),'[]'::jsonb)
 into history from public.cash_up_submissions s left join public.profiles p on p.id=s.created_by where s.cash_up_id=c.id;
 return jsonb_build_object('day_activity',case when app.has_store_role(p_store,'manager') then app.cash_sources(p_store,p_day)->'activity' else null end,'sealed',exists(select 1 from public.cash_ups where previous_shift=c.id),'started_by_name',(select full_name from public.profiles where id=c.created_by),'shifts',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'shift_number',x.shift_number,'status',x.status,'created_by_name',coalesce(p.full_name,'Team member'),'created_at',x.created_at,'opening_float',x.opening_float) order by x.shift_number),'[]') from public.cash_ups x left join public.profiles p on p.id=x.created_by where x.store_id=p_store and x.business_date=p_day and (x.created_by=auth.uid() or app.has_store_role(p_store,'manager'))),'session',case when c.id is null then null else to_jsonb(c)-'baseline' end,'sources',case when app.has_store_role(p_store,'manager') then source else source-'cumulative' end,'history',history,
  'expected',coalesce(c.opening_float,0)+(source->>'net')::numeric,
  'count_token',md5((source->>'fingerprint')||':'||c.opening_float::text||':'||c.version::text),
  'changed_since_count',c.latest_submission is not null and source->>'fingerprint' is distinct from (select sources->>'fingerprint' from public.cash_up_submissions where id=c.latest_submission),
  'movements',(select coalesce(jsonb_agg(to_jsonb(d)-'request_payload'-'request_id' order by created_at desc),'[]'::jsonb) from public.cash_drawer_movements d where store_id=p_store and business_date=p_day and app.has_store_role(p_store,'manager')));
end $function$
;

CREATE OR REPLACE FUNCTION public.submit_cash_up(p_cash_up uuid, p_counted numeric, p_denominations jsonb, p_fingerprint text, p_note text, p_request uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype; source jsonb; payload jsonb; prior public.cash_up_submissions%rowtype; sid uuid; total numeric;
begin
 select * into c from public.cash_ups where id=p_cash_up;
 perform app.require_module(c.store_id,array['cash_up']);
 if c.created_by<>auth.uid() and not app.has_store_role(c.store_id,'manager') then raise exception 'FORBIDDEN';end if;
 perform app.cash_day_lock(c.store_id,c.business_date);
 select * into c from public.cash_ups where id=p_cash_up for update;
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED'; end if;
 payload:=jsonb_build_object('user',auth.uid(),'counted',p_counted,'denominations',p_denominations,'fingerprint',p_fingerprint,'note',p_note);
 select * into prior from public.cash_up_submissions where cash_up_id=c.id and request_id=p_request;
 if found then if prior.request_payload<>payload then raise exception 'REQUEST_CONFLICT'; end if; return prior.id; end if;
 if c.status<>'OPEN' then raise exception 'CASH_UP_NOT_OPEN'; end if;
 if p_counted is null or p_counted::text in ('NaN','Infinity','-Infinity') or p_counted<0 or p_counted<>round(p_counted,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 if p_denominations is null or jsonb_typeof(p_denominations)<>'object' then raise exception 'INVALID_DENOMINATIONS'; end if;
 if exists(select 1 from jsonb_each(p_denominations) e where key not in ('200','100','50','20','10','5','2','1','0.5','0.2','0.1','0.05','0.02','0.01') or jsonb_typeof(value)<>'number' or value::text !~ '^[0-9]{1,7}$') then raise exception 'INVALID_DENOMINATIONS'; end if;
 if p_denominations<>'{}'::jsonb then
  select coalesce(sum(key::numeric*value::numeric),0) into total from jsonb_each_text(p_denominations);
  if total<>p_counted then raise exception 'CASH_COUNT_MISMATCH'; end if;
  if (select currency from public.businesses where id=c.business_id)<>'ZAR' then raise exception 'DENOMINATIONS_REQUIRE_ZAR'; end if;
 end if;
 source:=app.cash_shift_sources(c.id);
 if jsonb_array_length(source->'unclassified')>0 then raise exception 'UNCLASSIFIED_PAYMENTS'; end if;
 if p_fingerprint is distinct from md5((source->>'fingerprint')||':'||c.opening_float::text||':'||c.version::text) then raise exception 'CASH_ACTIVITY_CHANGED'; end if;
 if p_counted<>c.opening_float+(source->>'net')::numeric and nullif(btrim(p_note),'') is null then raise exception 'VARIANCE_NOTE_REQUIRED'; end if;
 if length(coalesce(p_note,''))>1000 then raise exception 'NOTE_TOO_LONG'; end if;
 insert into public.cash_up_submissions(cash_up_id,revision,counted,expected,denominations,note,sources,created_by,request_id,request_payload)
 values(c.id,c.version,p_counted,c.opening_float+(source->>'net')::numeric,p_denominations,p_note,source||jsonb_build_object('opening_float',c.opening_float),auth.uid(),p_request,payload) returning id into sid;
 update public.cash_ups set status='SUBMITTED',latest_submission=sid,version=version+1 where id=c.id;
 perform app.audit('cash_up.submit','cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('submission',sid,'counted',p_counted,'expected',c.opening_float+(source->>'net')::numeric));
 return sid;
end $function$
;

CREATE OR REPLACE FUNCTION public.open_cash_up(p_store uuid, p_day date, p_float numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
declare c public.cash_ups%rowtype;
begin
 perform app.require_module(p_store,array['cash_up']);
 if not exists(select 1 from public.stores where id=p_store and location_type='store') then raise exception 'LOCATION_NOT_SALEABLE'; end if;
 if p_day is null or p_day>(now() at time zone 'Africa/Johannesburg')::date then raise exception 'INVALID_DATE'; end if;
 if p_float is null or p_float::text in ('NaN','Infinity','-Infinity') or p_float<0 or p_float<>round(p_float,2) then raise exception 'INVALID_CASH_AMOUNT'; end if;
 perform app.cash_day_lock(p_store,p_day);
 select * into c from public.cash_ups where store_id=p_store and business_date=p_day order by shift_number desc limit 1;
 if found then if c.created_by<>auth.uid() and not app.has_store_role(p_store,'manager') then raise exception 'SHIFT_BELONGS_TO_OTHER_USER';end if; if c.opening_float<>p_float then raise exception 'CASH_UP_ALREADY_OPEN'; end if; return c.id; end if;
 insert into public.cash_ups(business_id,store_id,business_date,opening_float,created_by) values(app.store_business(p_store),p_store,p_day,p_float,auth.uid()) returning * into c;
 perform app.audit('cash_up.open','cash_up',c.id,c.business_id,c.store_id,null,jsonb_build_object('date',p_day,'opening_float',p_float));
 return c.id;
end $function$
;

alter table public.stock_movements add column stock_type text check(stock_type in('Individual','Bulk Stock'));
alter table public.goods_in_items add column stock_type text check(stock_type in('Individual','Bulk Stock'));
create function app.capture_stock_type() returns trigger language plpgsql security definer set search_path='' as $$
begin new.stock_type:=case when exists(select 1 from public.products where id=new.product_id and bulk_parent_id is not null) then 'Bulk Stock' else 'Individual' end;return new;end $$;
revoke all on function app.capture_stock_type() from public,anon,authenticated;
create trigger capture_stock_type before insert on public.stock_movements for each row execute function app.capture_stock_type();
create trigger capture_stock_type before insert on public.goods_in_items for each row execute function app.capture_stock_type();

CREATE OR REPLACE FUNCTION app_private.product_sales_summary(p_store uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(product_id uuid, name text, sold_qty numeric, sold_value numeric, current_qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $function$
  select p.id,p.name,coalesce(s.q,0),coalesce(s.v,0),case when p.tracking_type='SALES_ONLY' then null::numeric else coalesce(st.quantity,0) end from public.products p
  left join public.stock st on st.product_id=p.id and st.store_id=p_store
  left join (
    select x.product_id,sum(x.quantity) q,sum(x.value) v from (
      select li.product_id,li.quantity,li.line_total value,(g.created_at at time zone 'Africa/Johannesburg')::date occurred from public.goods_out_items li join public.goods_out g on g.id=li.goods_out_id where g.store_id=p_store
      union all select li.product_id,li.quantity,round(li.net_total/(1+i.tax_percent/100),2),(i.goods_issued_at at time zone 'Africa/Johannesburg')::date from public.sales_invoice_items li join public.sales_invoices i on i.id=li.invoice_id where i.store_id=p_store and i.goods_issued_at is not null
    ) x where (p_from is null or occurred>=p_from) and (p_to is null or occurred<=p_to) group by x.product_id
  ) s on s.product_id=p.id where p.store_id=p_store and p.is_active and app.has_store_access(p_store);
$function$
;

create index if not exists sales_invoices_issued_store_date on public.sales_invoices(store_id,goods_issued_at) where goods_issued_at is not null;
create function app.cash_sales_total(p_store uuid,p_day date,p_until timestamptz default null) returns numeric language sql stable security definer set search_path='' as $$
 select coalesce(sum(amount),0) from (
 select total_amount amount from public.goods_out where store_id=p_store and created_at >= (p_day::timestamp at time zone 'Africa/Johannesburg') and created_at < ((p_day+1)::timestamp at time zone 'Africa/Johannesburg') and (p_until is null or created_at<=p_until)
 union all select total from public.sales_invoices where store_id=p_store and goods_issued_at >= (p_day::timestamp at time zone 'Africa/Johannesburg') and goods_issued_at < ((p_day+1)::timestamp at time zone 'Africa/Johannesburg') and (p_until is null or goods_issued_at<=p_until)) sales;
$$;
revoke all on function app.cash_sales_total(uuid,date,timestamptz) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION app.cash_sources(p_store uuid, p_day date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with bounds as(select p_day::timestamp at time zone 'Africa/Johannesburg' lo,(p_day+1)::timestamp at time zone 'Africa/Johannesburg' hi), events as(
 select case when sale_type='CASH' then 'cash_sales' when sale_type='CARD_EFT' then 'card_sales' else 'credit_issued' end kind,id,total_amount amount
 from public.goods_out,bounds where not exists(select 1 from public.sale_receipts r where r.sale_id=goods_out.id) and store_id=p_store and created_at>=lo and created_at<hi
 union all select 'credit_issued',i.id,greatest(i.total-coalesce((select sum(e.amount) from public.invoice_entries e where e.invoice_id=i.id and e.kind='PAYMENT' and e.created_at<=i.goods_issued_at),0),0) from public.sales_invoices i,bounds where i.store_id=p_store and i.terms='CREDIT' and i.goods_issued_at>=lo and i.goods_issued_at<hi
 union all select case when p.method='CASH' then 'cash_sales' else 'card_sales' end,g.id,p.amount from public.sale_payments p join public.goods_out g on g.id=p.sale_id,bounds where g.store_id=p_store and g.created_at>=lo and g.created_at<hi
 union all select 'credit_issued',g.id,g.total_amount from public.goods_out g join public.sale_receipts r on r.sale_id=g.id,bounds where g.store_id=p_store and g.sale_type='CREDIT' and g.created_at>=lo and g.created_at<hi
 union all select 'invoice_payments',id,amount from public.invoice_entries,bounds where store_id=p_store and kind='PAYMENT' and created_at>=lo and created_at<hi
 union all select 'credit_payments',id,-amount from public.credit_transactions,bounds where store_id=p_store and txn_type='PAYMENT' and reference_table is null and created_at>=lo and created_at<hi
 union all select 'refunds',id,amount from public.customer_refunds,bounds where store_id=p_store and created_at>=lo and created_at<hi
 ), totals as(select jsonb_build_object('cash_sales',coalesce(sum(amount) filter(where kind='cash_sales'),0),
 'card_sales',coalesce(sum(amount) filter(where kind='card_sales'),0),'credit_issued',coalesce(sum(amount) filter(where kind='credit_issued'),0),
 'invoice_payments',coalesce(sum(amount) filter(where kind='invoice_payments'),0),'credit_payments',coalesce(sum(amount) filter(where kind='credit_payments'),0),
 'refunds',coalesce(sum(amount) filter(where kind='refunds'),0),
 'net_collected',coalesce(sum(case when kind='refunds' then -amount when kind='credit_issued' then 0 else amount end),0)) activity,
 coalesce(string_agg(kind||id::text||amount::text,',' order by kind,id,amount),'') fingerprint from events), drawer as(select app.cash_drawer_sources(p_store,p_day) value)
 select value||jsonb_build_object('activity',activity||jsonb_build_object('total_sales',app.cash_sales_total(p_store,p_day)),'fingerprint',md5((value->>'fingerprint')||totals.fingerprint)) from drawer,totals;
$function$
;

-- Historic immutable cash submissions are enriched only when read.
CREATE OR REPLACE FUNCTION app.cash_shift_sources(p_shift uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cash_ups%rowtype; source jsonb; result jsonb; k text; activity jsonb:='{}';
begin
 select * into c from public.cash_ups where id=p_shift;
 if exists(select 1 from public.cash_ups where previous_shift=c.id) then
  return (select sources||jsonb_build_object('activity',sources->'activity'||jsonb_build_object('total_sales',coalesce((sources->'activity'->>'total_sales')::numeric,app.cash_sales_total(c.store_id,c.business_date,created_at)-case when c.previous_shift is null then 0 else app.cash_sales_total(c.store_id,c.business_date,c.created_at) end))) from public.cash_up_submissions where id=c.latest_submission);
 end if;
 source:=app.cash_sources(c.store_id,c.business_date);result:=source;
 foreach k in array array['sales','invoices','credit','refunds','added','removed','net'] loop
  result:=jsonb_set(result,array[k],to_jsonb(coalesce((source->>k)::numeric,0)-coalesce((c.baseline->>k)::numeric,0)));
 end loop;
 for k in select jsonb_object_keys(source->'activity') loop
  activity:=jsonb_set(activity,array[k],to_jsonb((source->'activity'->>k)::numeric-coalesce((c.baseline->'activity'->>k)::numeric,case when k='total_sales' and c.previous_shift is not null then app.cash_sales_total(c.store_id,c.business_date,c.created_at) else 0 end)));
 end loop;
 return result||jsonb_build_object('activity',activity,'cumulative',source);
end $function$
;
