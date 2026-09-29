do $$
declare u uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();b uuid;s uuid;s2 uuid;c uuid;c2 uuid;p uuid;p2 uuid;o uuid;i uuid;d uuid;first_id uuid;mid uuid;v bigint;j integer;result jsonb;second jsonb;blocked boolean;note text;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'report@test.invalid','{}'),(other_user,'outside-report@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
 result:=public.create_business('Report Business','Branch One');b:=(result->>'business_id')::uuid;s:=(result->>'store_id')::uuid;s2:=public.create_location(b,'Branch Two','store');
 reset role;update public.stores set currency='USD' where id=s2;set local role authenticated;
 insert into public.customers(business_id,store_id,name,phone,address) values(b,s,'Alice Buyer','0111111111','First Road') returning id into c;
 insert into public.customers(business_id,store_id,name,phone,address) values(b,s2,'Bob Buyer','0222222222','Second Road') returning id into c2;
 p:=public.create_product(s,'First Product','REPORT-1',null,null,5,10);p2:=public.create_product(s2,'Second Product','REPORT-2',null,null,5,10);
 perform public.receive_stock(s,null,null,null,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',30)));
 for j in 1..8 loop
  o:=public.create_sales_order(case when j=8 then s2 else s end,case when j=8 then c2 else c end,jsonb_build_array(jsonb_build_object('product_id',case when j=8 then p2 else p end,'quantity',1)),gen_random_uuid());
  perform public.configure_order_delivery(o,0,true,jsonb_build_object('date',current_date+case when j=2 then 1 else 0 end,'address','Delivery Road','phone','0111111111'));
  perform public.process_sales_order(o,'confirm');i:=public.create_sales_invoice(o,current_date+1,'CASH',0,null);perform public.issue_sales_invoice(i);perform public.post_invoice_entry(i,'PAYMENT',10,gen_random_uuid(),'CASH');
  select id,reference into d,note from public.order_deliveries where invoice_id=i;v:=1;
  if note !~ '^DNN-[0-9]{8}-[0-9]{3}$' then raise exception 'ASSERT DNN numbering format: %',note;end if;
  if j=1 then first_id:=d;if right(note,3)<>'001' then raise exception 'ASSERT numbering starts at 001';end if;end if;
  if j in (3,4,6) then
   if j=6 then perform public.process_delivery(d,v,'update','{"address":"Delivery Road","phone":"0111111111","driver_name":"Thabo","vehicle_registration":"ABC123 GP","remarks":{}}',gen_random_uuid());v:=v+1;end if;
   perform public.issue_invoice_goods(i);
   -- Dispatch is permitted with no driver or vehicle details.
   perform public.process_delivery(d,v,'dispatch','{}',gen_random_uuid());v:=v+1;
  end if;
  if j=4 then perform public.process_delivery(d,v,'complete','{"received_by":"Receiver","notes":"Accepted"}',gen_random_uuid());end if;
  if j=5 then perform public.process_delivery(d,v,'reschedule',jsonb_build_object('date',current_date+2,'notes','Tomorrow instead'),gen_random_uuid());end if;
  if j=6 then perform public.process_delivery(d,v,'fail','{"notes":"Gate locked"}',gen_random_uuid());end if;
  if j=7 then perform public.process_delivery(d,v,'cancel','{"reason":"Other","notes":"Duplicate request"}',gen_random_uuid());end if;
 end loop;
 result:=public.delivery_report(array[s,s2],'{}',null,null,2);
 if (result->'summary'->>'total')::int<>8 or jsonb_array_length(result->'summary'->'values')<>2 or jsonb_array_length(result->'rows')<>2 or result->>'next' is null then raise exception 'ASSERT full totals, currencies and bounded pages';end if;
 if result->'summary'->>'pending'<>'2' or result->'summary'->>'scheduled'<>'1' or result->'summary'->>'delivered'<>'1' or result->'summary'->>'cancelled'<>'1' then raise exception 'ASSERT status totals %',result->'summary';end if;
 second:=public.delivery_report(array[s,s2],'{}',(result->>'next')::bigint,(result->>'until')::bigint,2);
 if second->'rows'->0->>'delivery_id'=result->'rows'->0->>'delivery_id' or jsonb_array_length(second->'rows')<>2 then raise exception 'ASSERT stable pagination';end if;
 result:=public.delivery_report(array[s],'{"status":"FAILED"}');if result->'rows'->0->>'failure_reason'<>'Gate locked' or result->'rows'->0->>'attempt_count'<>'1' then raise exception 'ASSERT attempts and failure reason';end if;
 result:=public.delivery_report(array[s],'{"status":"DELIVERED"}');if result->'rows'->0->>'received_by'<>'Receiver' or result->'rows'->0->>'confirmed_by' is null then raise exception 'ASSERT completion details';end if;
 result:=public.delivery_report(array[s],'{"status":"RESCHEDULED"}');if (result->'rows'->0->>'rescheduled_date')::date<>current_date+2 then raise exception 'ASSERT rescheduling history';end if;
 result:=public.delivery_report(array[s,s2],'{"customer":"bob","payment_status":"PAID"}');if result->'summary'->>'total'<>'1' or result->'rows'->0->>'currency'<>'USD' then raise exception 'ASSERT customer/payment filters';end if;
 result:=public.delivery_report(array[s],jsonb_build_object('date_field','scheduled','from',current_date+1,'to',current_date+1,'status','SCHEDULED'));if result->'summary'->>'total'<>'1' then raise exception 'ASSERT inclusive dates';end if;
 result:=public.delivery_report(array[s],'{"driver":"Nobody"}');if result->'summary'->>'total'<>'0' then raise exception 'ASSERT driver filter';end if;
 result:=public.delivery_report(array[s],'{"driver":"thabo"}');if result->'summary'->>'total'<>'1' or result->'rows'->0->>'vehicle_registration'<>'ABC123 GP' then raise exception 'ASSERT typed driver filter';end if;
 result:=public.delivery_report(array[s],jsonb_build_object('order_number',(select snapshot->>'order_reference' from public.order_deliveries where id=first_id),'invoice_number',(select snapshot->>'invoice_reference' from public.order_deliveries where id=first_id)));if result->'summary'->>'total'<>'1' then raise exception 'ASSERT order and invoice references';end if;
 result:=public.delivery_report(array[s],jsonb_build_object('delivery_number',(select reference from public.order_deliveries where id=first_id)));if result->'summary'->>'total'<>'1' then raise exception 'ASSERT note reference filter';end if;
 -- View-only staff may read the report without obtaining delivery mutation permissions.
 reset role;update public.memberships set role='employee' where business_id=b and user_id=u returning id into mid;
 insert into public.store_memberships(membership_id,store_id,business_id) values(mid,s,b) on conflict do nothing;
 insert into public.store_module_access(membership_id,store_id,permissions) values(mid,s,'{"reports":true,"reports_delivery":true,"reports_delivery_print":false,"reports_delivery_excel":false,"reports_delivery_pdf":false,"orders_deliveries":false}') on conflict(membership_id,store_id) do update set permissions=excluded.permissions;
 delete from public.store_memberships where membership_id=mid and store_id=s2;
 set local role authenticated;
 result:=public.delivery_report(array[s]);if result->'summary'->>'total'<>'7' then raise exception 'ASSERT report-only view';end if;
 foreach note in array array['print','xlsx','pdf'] loop
 blocked:=false;begin perform public.delivery_report(array[s],'{}',null,null,50,note);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT export permission %',note;end if;
 end loop;
 blocked:=false;begin perform public.delivery_report(array[s,s2]);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT inaccessible branch rejected';end if;
 reset role;update public.store_module_access set permissions='{"reports_delivery":false}' where membership_id=mid and store_id=s;set local role authenticated;
 blocked:=false;begin perform public.delivery_report(array[s]);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT report revocation';end if;
 reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',other_user,'role','authenticated')::text,true);set local role authenticated;
 blocked:=false;begin perform public.delivery_report(array[s]);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT tenant isolation';end if;
 reset role;raise exception 'TESTS_PASSED';
end $$;
