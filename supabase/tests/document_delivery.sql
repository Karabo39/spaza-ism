do $$
declare u uuid:=gen_random_uuid();other uuid:=gen_random_uuid();b uuid;s uuid;c uuid;p uuid;r jsonb;details jsonb;sid uuid:=gen_random_uuid();req uuid:=gen_random_uuid();iid uuid;oid uuid;normal uuid;expected_version bigint;nextdate date;blocked boolean;path text;mail jsonb;future timestamp;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(u,'delivery-owner@test.invalid','{}'),(other,'delivery-other@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
 r:=public.create_business('Document delivery','Shop');b:=(r->>'business_id')::uuid;s:=(r->>'store_id')::uuid;
 insert into public.customers(business_id,store_id,name,email,auto_email_invoices) values(b,s,'Email buyer','buyer@example.test',true) returning id into c;
 blocked:=false;begin update public.customers set email=null where id=c;exception when check_violation then blocked:=true;end;if not blocked then raise exception 'ASSERT opt in needs email';end if;
 p:=public.create_product(s,'Product','EMAIL-PRODUCT',null,null,1,10);
 perform public.set_credit_limit(c,1000);
 details:=jsonb_build_object('title','Monthly','customer_id',c,'frequency','MONTHLY','start_date',current_date,'next_date',current_date+10,'send_time','14:35','end_date',null,'due_days',30,'terms','CREDIT','tax_percent',15,'recipient','schedule@example.test','active',true,'auto_email',true,'items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1,'unit_price',12)));
 perform public.save_recurring_invoice(s,sid,0,details);
 select r.version,r.next_date into expected_version,nextdate from public.recurring_invoices r where id=sid;
 iid:=public.send_manual_recurring_invoice(s,sid,expected_version,details,req);
 if iid<>public.send_manual_recurring_invoice(s,sid,expected_version,details,req) then raise exception 'ASSERT manual idempotency';end if;
 if (select count(*) from public.sales_invoices where recurring_schedule_id=sid)<>1 or (select billing_period from public.sales_invoices where id=iid) is not null then raise exception 'ASSERT additional invoice';end if;
 if (select total from public.sales_invoices where id=iid)<>13.80 or (select quantity from public.stock where product_id=p)<>0 then raise exception 'ASSERT price and no stock movement';end if;
 if not exists(select 1 from public.recurring_invoices r where r.id=sid and r.active and r.next_date=nextdate and r.version=expected_version and r.send_time='14:35') then raise exception 'ASSERT manual leaves schedule unchanged';end if;
 if not exists(select 1 from public.recurring_invoice_deliveries where invoice_id=iid and recipient='schedule@example.test') then raise exception 'ASSERT manual recipient';end if;
 blocked:=false;begin perform public.send_manual_recurring_invoice(s,sid,expected_version,details||'{"recipient":"changed@example.test"}',req);exception when others then if sqlerrm<>'REQUEST_CHANGED' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT changed retry denied';end if;
 -- Normal invoices use the customer's opt-in only when issued.
 oid:=public.create_sales_order(s,c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1)),gen_random_uuid());
 perform public.process_sales_order(oid,'confirm');
 normal:=public.create_sales_invoice(oid,current_date+30,'CREDIT',0,'Normal invoice');
 if exists(select 1 from public.recurring_invoice_deliveries where invoice_id=normal) then raise exception 'ASSERT draft not emailed';end if;
 perform public.issue_sales_invoice(normal);
 if not exists(select 1 from public.recurring_invoice_deliveries where invoice_id=normal and recipient='buyer@example.test' and authorized_by=u) then raise exception 'ASSERT customer automatic email';end if;
 -- Document branding is separate, scoped and protected from stale writes.
 path:=b::text||'/'||gen_random_uuid()::text||'.png';
 insert into storage.objects(bucket_id,name) values('document-logos',path);
 perform public.set_document_logo(b,path,null);
 if (select logo_path from public.businesses where id=b) is not null then raise exception 'ASSERT navigation unchanged';end if;
 blocked:=false;begin perform public.set_document_logo(b,null,null);exception when others then if sqlerrm<>'LOGO_CHANGED' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT stale logo';end if;
 reset role;
 -- Store time zone, not Johannesburg, controls the due instant.
 update public.stores set timezone='America/Los_Angeles' where id=s;
 future:=(now() at time zone 'America/Los_Angeles')+interval '2 hours';
 update public.recurring_invoices set next_date=future::date,start_date=future::date,send_time=future::time where id=sid;
 if app_private.generate_recurring_invoice(sid) is not null then raise exception 'ASSERT not before selected time';end if;
 update public.recurring_invoices set start_date=current_date-2,next_date=current_date-1,send_time='00:00' where id=sid;
 oid:=app_private.generate_recurring_invoice(sid);
 if oid is null or (select count(*) from public.sales_invoices where recurring_schedule_id=sid)<>2 then raise exception 'ASSERT scheduled invoice independent from manual';end if;
 if (select count(*) from public.recurring_invoice_deliveries where invoice_id=oid)<>1 then raise exception 'ASSERT no duplicate preference delivery';end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
 mail:=public.claim_recurring_deliveries(10);
 if jsonb_array_length(mail)<>3 or exists(select 1 from jsonb_array_elements(mail) j where j->>'logo_path' is distinct from path) then raise exception 'ASSERT branded queue includes ordinary and recurring invoices';end if;
 reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);set local role authenticated;
 -- Sending an unsaved template must not silently start recurring billing.
 req:=gen_random_uuid();oid:=gen_random_uuid();
 normal:=public.send_manual_recurring_invoice(s,oid,0,details,req);
 if not exists(select 1 from public.recurring_invoices where id=oid and not active and next_date=nextdate) then raise exception 'ASSERT unsaved template stays inactive';end if;
 if normal<>public.send_manual_recurring_invoice(s,oid,0,details,req) then raise exception 'ASSERT new template retry';end if;
 reset role;
 update public.memberships set is_active=false where business_id=b and user_id=u;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
 if jsonb_array_length(public.claim_recurring_deliveries(10))<>0 then raise exception 'ASSERT revoked actor cannot email';end if;
 reset role;perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);set local role authenticated;
 blocked:=false;begin perform public.send_manual_recurring_invoice(s,sid,expected_version,details,gen_random_uuid());exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT tenant manual denied';end if;
 blocked:=false;begin perform public.set_document_logo(b,null,path);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT tenant logo denied';end if;
 if exists(select 1 from storage.objects where bucket_id='document-logos' and name=path) then raise exception 'ASSERT private logo';end if;
 reset role;raise exception 'TESTS_PASSED';
end $$;
