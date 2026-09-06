-- Run by test-db-local.mjs immediately before testing migration 0013.
insert into auth.users(id,email,raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001','upgrade-owner@test.invalid','{}'),
  ('aaaaaaaa-0000-0000-0000-000000000002','upgrade-staff@test.invalid','{}');
insert into public.businesses(id,name) values
  ('bbbbbbbb-0000-0000-0000-000000000001','Single store'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Many stores');
insert into public.stores(id,business_id,name) values
  ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Main'),
  ('cccccccc-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','One'),
  ('cccccccc-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002','Two');
insert into public.memberships(business_id,user_id,role) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','owner'),
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','employee'),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002','manager');
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
select public.create_product('cccccccc-0000-0000-0000-000000000001','Existing product','EXISTING');
select public.receive_stock('cccccccc-0000-0000-0000-000000000001',null,null,null,
  (select jsonb_build_array(jsonb_build_object('product_id',id,'quantity',7)) from public.products where name='Existing product'));
create temporary table original_ledger as select * from public.stock_movements;
