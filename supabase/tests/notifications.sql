do $$
declare owner_id uuid:=gen_random_uuid(); manager uuid:=gen_random_uuid(); cashier uuid:=gen_random_uuid(); biz uuid; loc uuid; member uuid; res jsonb; jobs jsonb; jid uuid; product uuid; tracked uuid; blocked boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'notification-owner@test.invalid','{}'),(manager,'notification-manager@test.invalid','{}'),(cashier,'notification-cashier@test.invalid','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);set local role authenticated;
  res:=public.create_business('Notification test','Shop');biz:=(res->>'business_id')::uuid;loc:=(res->>'store_id')::uuid;
  product:=public.create_product(loc,'Out product','NOTIFY-OUT');
  tracked:=public.create_product(loc,'Expiry product','NOTIFY-EXP',null,null,1,2,0,0,'each',true);
  perform public.receive_stock(loc,null,null,null,jsonb_build_array(jsonb_build_object('product_id',tracked,'quantity',3,'expiry_date',current_date+5)));
  member:=public.add_member_by_email(biz,'notification-manager@test.invalid','manager');perform public.set_member_locations(member,array[loc]);
  perform public.set_notification_preference(loc,'OUT_OF_STOCK',true,0);perform public.set_notification_preference(loc,'UPCOMING_EXPIRY',true,0);perform public.set_notification_preference(loc,'WEEKLY_PROFIT',true,0);
  blocked:=false;begin perform public.claim_notification_deliveries();exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'ASSERT browser cannot invoke delivery worker';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'role','authenticated')::text,true);perform public.set_notification_preference(loc,'OUT_OF_STOCK',true,0);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);perform public.set_member_locations(member,array[]::uuid[]);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',cashier,'role','authenticated')::text,true);
  blocked:=false;begin perform public.set_notification_preference(loc,'OUT_OF_STOCK',true,0);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;
  if not blocked then raise exception 'ASSERT employee preference denied';end if;
  reset role;set local role service_role;perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select jsonb_agg(value) into jobs from public.claim_notification_deliveries(20) value;
  if jsonb_array_length(jobs)<>3 then raise exception 'ASSERT three due owner notifications, got %',jobs;end if;
  for res in select value from jsonb_array_elements(jobs) loop
    if res->>'recipient'<>'notification-owner@test.invalid' then raise exception 'ASSERT revoked manager excluded';end if;
    if res->'payload'->>'kind'='OUT_OF_STOCK' and (res->'payload'->>'count')::int<>1 then raise exception 'ASSERT live out of stock count';end if;
    if res->'payload'->>'kind'='UPCOMING_EXPIRY' and (res->'payload'->>'count')::int<>1 then raise exception 'ASSERT live expiry count';end if;
    jid:=(res->>'id')::uuid;perform public.complete_notification_delivery(jid,true,'provider');
  end loop;
  if exists(select 1 from public.claim_notification_deliveries(20)) then raise exception 'ASSERT no duplicate notifications per period';end if;
  reset role;raise exception 'TESTS_PASSED';
end $$;
