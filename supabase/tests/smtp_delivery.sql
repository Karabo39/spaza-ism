do $$
declare u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); res jsonb; loc uuid; job uuid; k text; tok uuid; denied boolean;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'smtp-owner@test.invalid','{}'),(other_user,'smtp-other@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true); set local role authenticated;
 res:=public.create_business('SMTP test','Shop');loc:=(res->>'store_id')::uuid;
 res:=public.prepare_report_email(loc,gen_random_uuid(),repeat('a',64),'recipient@test.invalid');job:=(res->>'id')::uuid;k:='report-'||job;
 res:=public.smtp_delivery(k);tok:=(res->>'token')::uuid;
 if tok is null then raise exception 'ASSERT reservation';end if;
 if public.smtp_delivery(k)<>'{}'::jsonb then raise exception 'ASSERT duplicate blocked';end if;
 denied:=false;begin perform public.smtp_delivery(k,gen_random_uuid(),'receipt'); exception when others then denied:=sqlerrm='INVALID_RESERVATION';end;
 if not denied then raise exception 'ASSERT token required';end if;
 perform public.smtp_delivery(k,tok,'receipt');
 if public.smtp_delivery(k)->>'provider'<>'receipt' then raise exception 'ASSERT accepted replay';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);
 denied:=false;begin perform public.smtp_delivery(k);exception when others then denied:=sqlerrm='FORBIDDEN';end;
 if not denied then raise exception 'ASSERT cross-user blocked';end if;
 denied:=false;begin perform public.smtp_delivery('notification-'||gen_random_uuid());exception when others then denied:=sqlerrm='FORBIDDEN';end;
 if not denied then raise exception 'ASSERT worker key blocked';end if;
 reset role;
 if has_function_privilege('anon','public.smtp_delivery(text,uuid,text)','execute') then raise exception 'ASSERT anonymous execute';end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
 if public.smtp_delivery('notification-'||gen_random_uuid())->>'token' is null then raise exception 'ASSERT worker reservation';end if;
 reset role;raise exception 'TESTS_PASSED';
end $$;
