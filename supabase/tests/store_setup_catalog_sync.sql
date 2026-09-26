do $$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); biz uuid; shop uuid; other_shop uuid; wh uuid; foreign_wh uuid; member uuid;
 p uuid; existing uuid; fresh uuid; pack uuid; new_bulk uuid; bulk_store uuid; conflict uuid; r jsonb; before_products integer; before_audit integer; before_moves integer; blocked boolean;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'store-sync-owner@test.invalid','{}'),(staff,'store-sync-staff@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);set local role authenticated;
 r:=public.create_business('Store sync test','Store');biz:=(r->>'business_id')::uuid;shop:=(r->>'store_id')::uuid;
 other_shop:=public.create_location(biz,'Other store','store');wh:=public.create_location(biz,'Warehouse','warehouse');
 p:=public.create_product(wh,'Warehouse name','sync-code',null,null,2,4,0,0,'each');
 existing:=public.create_product(shop,'Store name','sync-code',null,null,12,24,0,0,'each');
 fresh:=public.create_product(wh,'Fresh','fresh-code',null,null,3,6,0,0,'each');
 new_bulk:=public.create_product_catalog(wh,'Bulk item',jsonb_build_object('cost',5,'selling',10,'bulk_enabled',true,'units_per_pack',6,'bulk_unit','case'));
 reset role;
 update public.products set sku='SYNC-SKU' where id in(p,existing);
 select count(*) into before_products from public.products;
 select count(*) into before_audit from public.audit_logs;
 set local role authenticated;
 perform public.receive_stock(wh,null,null,null,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',100)));
 perform public.receive_stock(shop,null,null,null,jsonb_build_array(jsonb_build_object('product_id',existing,'quantity',20)));
 reset role;select count(*) into before_audit from public.audit_logs;select count(*) into before_moves from public.stock_movements;set local role authenticated;
 r:=public.sync_store_products(shop,wh,true);
 if (r->>'created')::int<>2 or (r->>'updated')::int<>1 or (r->>'skipped')::int<>0 then raise exception 'ASSERT preview %',r;end if;
 reset role;
 if (select count(*) from public.products)<>before_products or (select count(*) from public.audit_logs)<>before_audit or exists(select 1 from app.warehouse_product_links where warehouse_id=wh) then raise exception 'ASSERT preview persists nothing';end if;
 set local role authenticated;
 r:=public.sync_store_products(shop,wh,false);
 if (r->>'created')::int<>2 or (r->>'updated')::int<>1 or (r->>'skipped')::int<>0 then raise exception 'ASSERT sync %',r;end if;
 if (select cost_price from public.products where id=existing)<>12 or (select selling_price from public.products where id=existing)<>24 or (select name from public.products where id=existing)<>'Warehouse name' then raise exception 'ASSERT prices preserved metadata refreshed';end if;
 if (select quantity from public.stock where product_id=p)<>100 or (select quantity from public.stock where product_id=existing)<>20 then raise exception 'ASSERT stock unchanged';end if;
 reset role;
 select source_product_id into bulk_store from app.warehouse_product_links where warehouse_id=wh and product_id=new_bulk;
 select pack_product_id into pack from public.bulk_conversions where unit_product_id=bulk_store;
 if pack is null or (select units_per_pack from public.bulk_conversions where pack_product_id=pack)<>6 or (select quantity from public.stock where product_id=pack)<>0 then raise exception 'ASSERT copied bulk configuration';end if;
 if (select count(*) from public.stock_movements)<>before_moves then raise exception 'ASSERT no stock movements';end if;
 set local role authenticated;
 r:=public.sync_store_products(shop,wh,false);
 if (r->>'created')::int<>0 or (r->>'updated')::int<>0 or (r->>'matched')::int<>3 then raise exception 'ASSERT repeat does not duplicate %',r;end if;
 -- Bulk conflicts roll back the parent metadata as well.
 reset role;update public.bulk_conversions set units_per_pack=8 where pack_product_id=pack;update public.products set name='Changed source bulk' where id=new_bulk;set local role authenticated;
 r:=public.sync_store_products(shop,wh,false);
 if (r->>'skipped')::int<>1 or (select name from public.products where id=bulk_store)<>'Bulk item' then raise exception 'ASSERT atomic bulk conflict %',r;end if;
 -- A SKU and barcode referring to different products must never be merged.
 conflict:=public.create_product(shop,'Conflicting SKU',null,null,null,1,1,0,0,'each');
 reset role;update public.products set sku='SYNC-SKU' where id=conflict;set local role authenticated;
 r:=public.sync_store_products(shop,wh,false);
 if not exists(select 1 from jsonb_array_elements(r->'errors') e where e->>'error'='CONFLICTING_PRODUCT_IDENTIFIERS') then raise exception 'ASSERT conflicting identifiers %',r;end if;
 reset role;update public.products set sku=null where id=conflict;set local role authenticated;
 -- Cross-currency matches retain local prices; new products are explicitly skipped.
 perform public.set_store_currency(other_shop,'USD');
 conflict:=public.create_product(other_shop,'Dollar product','sync-code',null,null,7,9,0,0,'each');
 r:=public.sync_store_products(other_shop,wh,false);
 if (select selling_price from public.products where id=conflict)<>9 or not exists(select 1 from jsonb_array_elements(r->'errors')e where e->>'error'='CURRENCY_MISMATCH') then raise exception 'ASSERT currency treatment %',r;end if;
 -- Inactive destinations and withdrawn warehouse access are rejected by the API.
 reset role;update public.stores set is_active=false where id=other_shop;set local role authenticated;
 blocked:=false;begin perform public.sync_store_products(other_shop,wh,false);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'ASSERT inactive store sync forbidden';end if;
 reset role;update public.stores set is_active=true where id=other_shop;set local role authenticated;
 -- A scoped assignment must not remove another store or its permissions.
 reset role;
 insert into public.memberships(business_id,user_id,role) values(biz,staff,'employee') returning id into member;
 set local role authenticated;
 perform public.set_member_locations(member,array[other_shop]);
 perform public.set_store_member_access(shop,member,true);
 perform public.set_store_member_access(shop,member,false);
 if not exists(select 1 from public.store_memberships where membership_id=member and store_id=other_shop) or exists(select 1 from public.store_memberships where membership_id=member and store_id=shop) then raise exception 'ASSERT scoped assignment';end if;
 perform public.set_store_member_access(shop,member,true);
 -- Even an assigned employee cannot copy the catalog or grant themselves access.
 reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);set local role authenticated;
 blocked:=false;begin perform public.sync_store_products(shop,wh,false);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'ASSERT employee sync forbidden';end if;
 blocked:=false;begin perform public.set_store_member_access(shop,member,false);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'ASSERT employee assignment forbidden';end if;
 reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);set local role authenticated;
 perform public.set_member_locations(member,array[shop,other_shop,wh]);
 reset role;update public.memberships set role='manager' where id=member;set local role authenticated;
 perform public.set_store_module_access(member,shop,jsonb_build_object('products',false),coalesce((select version from public.store_module_access where membership_id=member and store_id=shop),0));
 reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);set local role authenticated;
 blocked:=false;begin perform public.sync_store_products(shop,wh,false);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'ASSERT manager product permission enforced';end if;
 reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);set local role authenticated;
 r:=public.create_business('Foreign business','Foreign store');foreign_wh:=public.create_location((r->>'business_id')::uuid,'Foreign warehouse','warehouse');
 blocked:=false;begin perform public.sync_store_products(shop,foreign_wh,false);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'ASSERT cross-tenant sync forbidden';end if;
 reset role;
 if has_function_privilege('anon','public.sync_store_products(uuid,uuid,boolean)','execute') or has_function_privilege('authenticated','app_private.copy_store_catalog_row(uuid,uuid,uuid)','execute') or has_function_privilege('anon','public.set_store_member_access(uuid,uuid,boolean)','execute') then raise exception 'ASSERT private helper grants';end if;
 raise exception 'TESTS_PASSED';
end $$;
