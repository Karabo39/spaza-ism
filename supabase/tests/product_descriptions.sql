do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); b uuid; s uuid; p uuid; old_product uuid; result jsonb; values_json jsonb; blocked boolean;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'description-owner@test.invalid','{}'),(outsider,'description-outsider@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
 result:=public.create_business('Description test','Description shop');b:=(result->>'business_id')::uuid;s:=(result->>'store_id')::uuid;
 old_product:=public.create_product(s,'Legacy item');
 if (select description from public.v_product_catalog where id=old_product) is not null then raise exception 'ASSERT legacy blank';end if;
 p:=public.create_product_with_description(p_store=>s,p_name=>'New item',p_barcode=>'DESC-1',p_description=>E'  Line one\nLine two  ');
 if (select description from public.v_product_stock where id=p)<>E'Line one\nLine two' or (select description from public.v_product_catalog where id=p)<>E'Line one\nLine two' then raise exception 'ASSERT both views persist multiline description';end if;
 values_json:='{"name":"Legacy item","cost_price":0,"selling_price":0,"min_stock_level":0,"reorder_level":0,"unit":"each","track_expiry":false,"is_active":true,"description":"Existing item details"}'::jsonb;
 perform public.save_product_details(old_product,values_json);
 perform public.save_product_details(old_product,values_json-'description');
 if (select description from public.products where id=old_product)<>'Existing item details' then raise exception 'ASSERT legacy saves preserve description';end if;
 perform public.save_product_details(old_product,values_json||'{"description":"  "}');
 if (select description from public.products where id=old_product) is not null then raise exception 'ASSERT can clear description';end if;
 blocked:=false;begin perform public.create_product_with_description(p_store=>s,p_name=>'Too long',p_barcode=>'TOO-LONG',p_description=>repeat('x',1001));exception when others then if sqlerrm<>'PRODUCT_DESCRIPTION_TOO_LONG' then raise;end if;blocked:=true;end;
 if not blocked or exists(select 1 from public.products where store_id=s and name='Too long') or exists(select 1 from public.product_barcodes where store_id=s and barcode='TOO-LONG') then raise exception 'ASSERT invalid creation atomic';end if;
 blocked:=false;begin perform public.save_product_details(old_product,values_json||jsonb_build_object('description',repeat('x',1001),'name','Must rollback'));exception when others then if sqlerrm<>'PRODUCT_DESCRIPTION_TOO_LONG' then raise;end if;blocked:=true;end;
 if not blocked or (select name from public.products where id=old_product)<>'Legacy item' then raise exception 'ASSERT invalid edit atomic';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 blocked:=false;begin perform public.create_product_with_description(p_store=>s,p_name=>'Forbidden');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
 if not blocked or exists(select 1 from public.v_product_catalog where id=p) then raise exception 'ASSERT store isolation';end if;
 if has_function_privilege('anon','public.create_product_with_description(uuid,text,text,uuid,uuid,numeric,numeric,numeric,numeric,text,boolean,text)','EXECUTE') then raise exception 'ASSERT no anonymous execute';end if;
 reset role;
 raise exception 'TESTS_PASSED';
end $$;
