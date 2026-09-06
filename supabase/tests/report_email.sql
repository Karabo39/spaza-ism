do $$
declare u uuid:=gen_random_uuid(); res jsonb; loc uuid; request_id uuid:=gen_random_uuid(); job uuid; blocked boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,'report-email-owner@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
  res:=public.create_business('Email test','Shop');loc:=(res->>'store_id')::uuid;
  res:=public.prepare_report_email(loc,request_id,repeat('a',64),'recipient@test.invalid');job:=(res->>'id')::uuid;
  if (public.prepare_report_email(loc,request_id,repeat('a',64),'recipient@test.invalid')->>'id')::uuid<>job then raise exception 'ASSERT stable email request'; end if;
  blocked:=false;begin perform public.prepare_report_email(loc,request_id,repeat('b',64),'recipient@test.invalid');exception when others then if sqlerrm<>'REQUEST_CONFLICT' then raise;end if;blocked:=true;end;
  if not blocked then raise exception 'ASSERT changed report rejected';end if;
  perform public.complete_report_email(job,'provider');
  if not (public.prepare_report_email(loc,request_id,repeat('a',64),'recipient@test.invalid')->>'sent')::boolean then raise exception 'ASSERT completed email recognized';end if;
  for i in 1..19 loop perform public.prepare_report_email(loc,gen_random_uuid(),repeat('a',64),'recipient@test.invalid');end loop;
  blocked:=false;begin perform public.prepare_report_email(loc,gen_random_uuid(),repeat('a',64),'recipient@test.invalid');exception when others then if sqlerrm<>'EMAIL_RATE_LIMITED' then raise;end if;blocked:=true;end;
  if not blocked then raise exception 'ASSERT email quota';end if;
  reset role;raise exception 'TESTS_PASSED';
end $$;
