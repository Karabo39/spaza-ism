do $$
declare u uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); biz uuid; loc uuid; path text; replacement text; result jsonb;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'logo-owner@test.invalid','{}'),(worker,'logo-worker@test.invalid','{}'),(other,'logo-other@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
  result:=public.create_business('Logo test','Shop');biz:=(result->>'business_id')::uuid;loc:=(result->>'store_id')::uuid;
  path:=biz::text||'/'||gen_random_uuid()::text||'.png';replacement:=biz::text||'/'||gen_random_uuid()::text||'.webp';
  begin perform public.set_business_logo(biz,path);raise exception 'ASSERT missing logo denied';exception when others then if sqlerrm<>'LOGO_NOT_FOUND' then raise;end if;end;
  insert into storage.objects(bucket_id,name) values('business-logos',path),('business-logos',replacement);
  perform public.set_business_logo(biz,path);
  if (select logo_path from public.businesses where id=biz)<>path then raise exception 'ASSERT logo set';end if;
  delete from storage.objects where name=path;
  if not exists(select 1 from storage.objects where name=path) then raise exception 'ASSERT cannot delete current logo';end if;
  perform public.set_business_logo(biz,replacement);delete from storage.objects where name=path;
  if exists(select 1 from storage.objects where name=path) then raise exception 'ASSERT old logo cleanup allowed';end if;
  reset role;insert into public.memberships(business_id,user_id,role) values(biz,worker,'employee');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);set local role authenticated;
  if not exists(select 1 from storage.objects where name=replacement) then raise exception 'ASSERT business member reads logo';end if;
  begin perform public.set_business_logo(biz,null);raise exception 'ASSERT employee logo change denied';exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
  begin insert into storage.objects(bucket_id,name) values('business-logos',path);raise exception 'ASSERT employee upload denied';exception when insufficient_privilege then null;end;
  reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);set local role authenticated;
  if exists(select 1 from storage.objects where name=replacement) then raise exception 'ASSERT unrelated user cannot read logo';end if;
  begin insert into storage.objects(bucket_id,name) values('business-logos',path);raise exception 'ASSERT cross-tenant upload denied';exception when insufficient_privilege then null;end;
  reset role;raise exception 'TESTS_PASSED';
end $$;
