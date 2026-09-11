do $$
declare owner_id uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); m uuid; b uuid; s uuid; s2 uuid; product uuid; customer uuid; ord uuid; inv uuid; quote uuid; result jsonb; base jsonb; perms jsonb; v bigint:=0; blocked boolean; payload jsonb; old_count integer;
begin
 insert into auth.users(id,email,raw_user_meta_data) values(owner_id,'detail-owner@test.invalid','{}'),(staff,'detail-staff@test.invalid','{}');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);set local role authenticated;
 result:=public.create_business('Detailed access','First shop');b:=(result->>'business_id')::uuid;s:=(result->>'store_id')::uuid;s2:=public.create_location(b,'Second shop','store',null);
 product:=public.create_product(s,'Test item',null,null,null,1,10);perform public.receive_stock(s,null,null,null,jsonb_build_array(jsonb_build_object('product_id',product,'quantity',10)));
 insert into public.customers(business_id,store_id,name) values(b,s,'Customer') returning id into customer;
 payload:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',10));
 ord:=public.create_sales_order(s,customer,payload,gen_random_uuid(),null);perform public.process_sales_order(ord,'confirm');inv:=public.create_sales_invoice(ord,current_date+1,'CASH');perform public.issue_sales_invoice(inv);
 quote:=public.save_quote(s,customer,payload,current_date+1,0,null,gen_random_uuid());
 reset role;m:=public.add_member_by_email(b,'detail-staff@test.invalid','employee');set local role authenticated;perform public.set_member_locations(m,array[s,s2]);
 select jsonb_object_agg(key,false) into base from public.module_catalog where parent_key is null;
 perms:=base||'{"dashboard":true,"orders":true,"invoices":true,"orders_new":false,"orders_recent":false,"invoices_create_quotes":false,"invoices_view_quotes":false,"invoices_create_from_order":false,"invoices_view_invoices":false,"dashboard_movements":false,"invoices_outstanding":false,"invoices_paid":false}';
 v:=public.set_store_module_access(m,s,perms,v);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 if app.has_module(s,'orders_new') or not app.has_module(s2,'orders_new') then raise exception 'ASSERT separate stores';end if;
 if app.has_module(s,'dashboard_check_stock') then raise exception 'ASSERT linked module required';end if;
 if app.has_module(s,'dashboard_adjust') or app.has_module(s,'dashboard_locations') then raise exception 'ASSERT role restrictions';end if;
 if exists(select 1 from public.sales_orders where store_id=s) or exists(select 1 from public.sales_quotes where store_id=s) or exists(select 1 from public.sales_invoices where store_id=s) or exists(select 1 from public.stock_movements where store_id=s) then raise exception 'ASSERT direct reads denied';end if;
 result:=public.dashboard_summary(s);if result ? 'stock_value' or result ? 'outstanding_credit' then raise exception 'ASSERT dashboard widget projection';end if;
 result:=public.invoice_summary(s);if result ? 'outstanding' or result ? 'paid' or not result ? 'invoiced' then raise exception 'ASSERT summary projection';end if;
 blocked:=false;begin perform public.create_order_with_contact(s,null,payload,gen_random_uuid(),null,'{"name":"Forbidden guest"}');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT new order denied';end if;
 blocked:=false;begin perform public.order_workflow_summary(s);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT recent denied';end if;
 blocked:=false;begin perform public.process_sales_order(ord,'cancel','Denied');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT order action denied';end if;
 blocked:=false;begin perform public.save_quote(s,customer,payload,current_date+1,0,null,gen_random_uuid());exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT create quote denied';end if;
 blocked:=false;begin perform public.set_quote_status(quote,'SENT',1);exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT quote action denied';end if;
 blocked:=false;begin perform public.create_sales_invoice(ord,current_date+1,'CASH');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT invoice creation denied before replay';end if;
 blocked:=false;begin perform public.post_invoice_entry(inv,'PAYMENT',10,gen_random_uuid(),'CASH');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT invoice payment denied';end if;
 blocked:=false;begin perform public.prepare_document_email('invoice',inv,gen_random_uuid(),repeat('a',64),'test@test.invalid');exception when others then if sqlerrm<>'FORBIDDEN' then raise;end if;blocked:=true;end;if not blocked then raise exception 'ASSERT email denied';end if;
 -- New Order and Create Quotes work independently of historical document access.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 perms:=perms||'{"orders_new":true,"invoices_create_quotes":true}';v:=public.set_store_module_access(m,s,perms,v);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 ord:=public.create_sales_order(s,customer,payload,gen_random_uuid(),null);
 quote:=public.save_quote(s,customer,payload,current_date+1,0,null,gen_random_uuid());
 if ord is null or quote is null or exists(select 1 from public.sales_orders where id=ord) or exists(select 1 from public.sales_quotes where id=quote) then raise exception 'ASSERT independent creation';end if;
 -- Root-only legacy saves preserve explicit child denials.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 v:=public.set_store_module_access(m,s,'{"orders":false,"invoices":true,"dashboard":true}',v);
 if (select permissions->>'invoices_view_invoices' from public.store_module_access where membership_id=m and store_id=s)<>'false' then raise exception 'ASSERT legacy editor preserves child denial';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 if app.has_module(s,'orders_new') then raise exception 'ASSERT parent denies enabled child';end if;
 reset role;raise exception 'TESTS_PASSED';
end $$;
