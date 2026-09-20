do $$
declare u uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); m uuid; biz uuid; shop uuid; wh uuid; wp uuid; wu uuid; sp uuid; su uuid; conversion uuid; t uuid; r jsonb; blocked boolean;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'bulk-flow-owner@test.invalid','{}'),(staff,'bulk-flow-staff@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
 r:=public.create_business('Bulk flow','Shop');biz:=(r->>'business_id')::uuid;shop:=(r->>'store_id')::uuid;wh:=public.create_location(biz,'Warehouse','warehouse');
 wp:=public.create_product(wh,'Pack',null,null,null,12,18,0,0,'pack');wu:=public.create_product(wh,'Individual',null,null,null,2,3,0,0,'each');
 sp:=public.create_product(shop,'Pack',null,null,null,12,18,0,0,'pack');su:=public.create_product(shop,'Individual',null,null,null,2,3,0,0,'each');
 perform public.receive_stock(wh,null,null,null,jsonb_build_array(jsonb_build_object('product_id',wp,'quantity',10)));
 conversion:=public.set_bulk_conversion(wp,wu,6);perform public.unpack_stock(conversion,2,'Prepare loose stock',gen_random_uuid());
 perform public.set_bulk_conversion(sp,su,6);
 t:=public.create_stock_transfer(wh,shop,jsonb_build_array(jsonb_build_object('source_product_id',wp,'destination_product_id',sp,'quantity',3)),gen_random_uuid());
 perform public.process_stock_transfer(t,'submit');perform public.process_stock_transfer(t,'dispatch');perform public.process_stock_transfer(t,'receive');
 conversion:=public.set_bulk_conversion(sp,su,6);
 reset role;m:=public.add_member_by_email(biz,'bulk-flow-staff@test.invalid','employee');set local role authenticated;perform public.set_member_locations(m,array[shop]);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 perform public.unpack_stock(conversion,1,'Unpack delivered pack',gen_random_uuid());
 blocked:=false;begin perform public.set_bulk_conversion(sp,su,7);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked then raise exception 'ASSERT cashier cannot change ratio';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 t:=public.create_stock_transfer(wh,shop,jsonb_build_array(jsonb_build_object('source_product_id',wu,'destination_product_id',su,'quantity',6)),gen_random_uuid());
 perform public.process_stock_transfer(t,'submit');perform public.process_stock_transfer(t,'dispatch');perform public.process_stock_transfer(t,'receive');
 if (select quantity from public.stock where product_id=wp)<>5 or (select quantity from public.stock where product_id=wu)<>6 or (select quantity from public.stock where product_id=sp)<>2 or (select quantity from public.stock where product_id=su)<>12 then raise exception 'ASSERT bulk and individual quantities conserved';end if;
 if (select count(*) from public.bulk_unpackings where business_id=biz)<>2 then raise exception 'ASSERT unpack histories';end if;
 if (select count(*) from public.stock_movements where business_id=biz and movement_type in ('UNPACK_IN','UNPACK_OUT'))<>4 then raise exception 'ASSERT stock audit';end if;
 reset role;raise exception 'TESTS_PASSED';
end $$;
