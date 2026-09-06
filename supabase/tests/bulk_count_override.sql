do $$
declare u uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); biz uuid; loc uuid; pack uuid; unit uuid; conversion uuid; req uuid:=gen_random_uuid(); unpacked uuid; result jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'count-owner@test.invalid','{}'),(worker,'count-worker@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
  result:=public.create_business('Count override test','Shop');biz:=(result->>'business_id')::uuid;loc:=(result->>'store_id')::uuid;
  pack:=public.create_product(loc,'Pack',null,null,null,60,90,0,0,'pack',true);unit:=public.create_product(loc,'Bottle',null,null,null,10,15,0,0,'each',true);conversion:=public.set_bulk_conversion(pack,unit,6);
  begin perform public.unpack_stock_with_count(conversion,1,1,'Counted shelf stock',req);raise exception 'ASSERT expiry required';exception when others then if sqlerrm<>'EXPIRY_DATE_REQUIRED' then raise;end if;end;
  if exists(select 1 from public.stock_adjustments where store_id=loc) then raise exception 'ASSERT failure atomic';end if;
  unpacked:=public.unpack_stock_with_count(conversion,1,2,'Counted shelf stock',req,'2028-01-01');
  if public.unpack_stock_with_count(conversion,1,2,'Counted shelf stock',req,'2028-01-01')<>unpacked then raise exception 'ASSERT count override retry';end if;
  if (select quantity from public.stock where product_id=pack)<>1 or (select quantity from public.stock where product_id=unit)<>6 then raise exception 'ASSERT counted pack and unit stock';end if;
  if (select sum(quantity) from public.stock_batches where product_id=pack)<>1 or (select sum(quantity) from public.stock_batches where product_id=unit)<>6 then raise exception 'ASSERT expiry allocation';end if;
  if (select count(*) from public.stock_adjustments where store_id=loc)<>1 then raise exception 'ASSERT correction once';end if;
  if exists(select 1 from public.reconcile_stock(loc) where diff<>0) then raise exception 'ASSERT count override reconciliation';end if;
  begin perform public.unpack_stock_with_count(conversion,1,3,'Changed retry',req,'2028-01-01');raise exception 'ASSERT changed retry denied';exception when others then if sqlerrm<>'REQUEST_CONFLICT' then raise;end if;end;
  reset role;insert into public.memberships(business_id,user_id,role) values(biz,worker,'employee');insert into public.store_memberships(business_id,store_id,membership_id) select biz,loc,id from public.memberships where business_id=biz and user_id=worker;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);set local role authenticated;
  begin perform public.unpack_stock_with_count(conversion,2,2,'Forbidden',gen_random_uuid(),'2028-01-01');raise exception 'ASSERT employee override denied';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  reset role;raise exception 'TESTS_PASSED';
end $$;
