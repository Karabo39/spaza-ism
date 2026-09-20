-- The September bulk workflow deliberately retires implicit count corrections.
do $$
declare owner_id uuid:=gen_random_uuid(); result jsonb; loc uuid; pack uuid; unit uuid; conversion uuid;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'strict-unpack@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);set local role authenticated;
 result:=public.create_business('Strict unpack test','Shop');loc:=(result->>'store_id')::uuid;
 pack:=public.create_product(loc,'Pack',null,null,null,60,90,0,0,'pack',true);unit:=public.create_product(loc,'Bottle',null,null,null,10,15,0,0,'each',true);conversion:=public.set_bulk_conversion(pack,unit,6);
 begin
  perform public.unpack_stock_with_count(conversion,1,2,'Counted shelf stock',gen_random_uuid(),'2028-01-01');
  raise exception 'ASSERT count correction must use Adjust Stock';
 exception when others then if sqlerrm<>'UNPACK_COUNT_OVERRIDE_DISABLED' then raise;end if;end;
 if exists(select 1 from public.stock_adjustments where store_id=loc) then raise exception 'ASSERT no implicit adjustment';end if;
 if exists(select 1 from public.bulk_unpackings where store_id=loc) then raise exception 'ASSERT no unpacking';end if;
 if exists(select 1 from public.stock where store_id=loc and quantity<>0) then raise exception 'ASSERT quantities unchanged';end if;
 reset role;raise exception 'TESTS_PASSED';
end $$;
