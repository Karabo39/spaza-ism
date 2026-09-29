-- Customer consent is deliberately not broadened from the older invoice-only option.
alter table public.customers add column email_notifications boolean not null default false;
alter table public.customers add constraint customer_notifications_email check(not email_notifications or (email is not null and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
do $$ declare definition text;begin
 select pg_get_functiondef('public.update_customer_profile(uuid,timestamptz,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'auto_email_invoices=','email_notifications=coalesce((p_details->>''email_notifications'')::boolean,c.email_notifications),auto_email_invoices=');execute definition;
 select pg_get_viewdef('public.v_credit_customers'::regclass,true) into definition;
 definition:=replace(definition,'cu.auto_email_invoices','cu.auto_email_invoices, cu.email_notifications');
 execute 'create or replace view public.v_credit_customers with(security_invoker=true) as '||definition;
end $$;

-- Remember an explicitly selected cash/card customer as well as credit customers.
-- This is contact attribution only; cash sales never create account debt.
do $$ declare definition text;begin
 select pg_get_functiondef('app_private.complete_sale(uuid,text,uuid,jsonb,boolean,text,uuid,text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'case when v_type=''CREDIT'' then p_customer else null end','p_customer');
 definition:=regexp_replace(definition,'if v_type = ''CREDIT'' then','if p_customer is not null and not exists(select 1 from public.customers where id=p_customer and store_id=p_store and is_active) then raise exception ''CUSTOMER_REQUIRED'';end if; if v_type = ''CREDIT'' then');
 execute definition;
end $$;

create table public.customer_document_notifications (
 id uuid primary key default gen_random_uuid(), event_key text not null unique,
 business_id uuid not null references public.businesses(id), store_id uuid not null references public.stores(id),
 customer_id uuid not null references public.customers(id), authorized_by uuid references auth.users(id),
 module text not null, recipient text not null, document jsonb not null,
 state text not null default 'PENDING' check(state in ('PENDING','PROCESSING','SENT','UNCERTAIN','FAILED','SKIPPED')),
 token uuid, provider text, last_error text, attempts int not null default 0,
 created_at timestamptz not null default now(), available_at timestamptz not null default now(), claimed_at timestamptz, sent_at timestamptz
);
create index customer_notification_pending on public.customer_document_notifications(available_at,id) where state='PENDING';
create index customer_notification_customer on public.customer_document_notifications(customer_id,created_at desc,id);
create index customer_notification_store on public.customer_document_notifications(store_id);
create index customer_notification_business on public.customer_document_notifications(business_id);
create index customer_notification_actor on public.customer_document_notifications(authorized_by);
alter table public.customer_document_notifications enable row level security;
revoke all on public.customer_document_notifications from public,anon,authenticated;
grant select(id,customer_id,store_id,document,state,last_error,created_at,sent_at) on public.customer_document_notifications to authenticated;
create policy customer_notification_read on public.customer_document_notifications for select to authenticated
 using(app.has_store_access(store_id) and app.has_module(store_id,'credit') and app.has_module(store_id,module));

-- Private helper: recipient, tenant and business branding can never be supplied by a client.
create function app_private.queue_customer_document(p_customer uuid,p_store uuid,p_actor uuid,p_module text,p_key text,p_document jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.customers%rowtype;s public.stores%rowtype;b public.businesses%rowtype;j uuid;
begin
 select * into c from public.customers where id=p_customer and store_id=p_store;
 if c.id is null or not c.email_notifications or not c.is_active or nullif(c.email::text,'') is null then return null;end if;
 select * into s from public.stores where id=p_store and business_id=c.business_id;
 select * into b from public.businesses where id=c.business_id;
 if s.id is null then return null;end if;
 insert into public.customer_document_notifications(event_key,business_id,store_id,customer_id,authorized_by,module,recipient,document)
 values(p_key,c.business_id,p_store,c.id,p_actor,p_module,c.email::text,
 jsonb_build_object('customer',c.name,'business',b.name,'store',s.name,'currency',s.currency,'logo_path',b.document_logo_path,
 'address',c.address,'business_address',coalesce(b.document_address,s.address),'business_contact',concat_ws(' · ',b.document_phone,b.document_email))||p_document)
 on conflict(event_key) do nothing returning id into j;
 return coalesce(j,(select id from public.customer_document_notifications where event_key=p_key and customer_id=c.id));
end $$;
revoke all on function app_private.queue_customer_document(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;

-- A canonical invoice snapshot is shared by goods release, payments and adjustments.
create function app_private.customer_invoice_document(p_invoice uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('type','Invoice','reference',i.reference,'related_reference',o.reference,
 'date',i.invoice_date,'due',i.due_date,'currency',i.currency,'customer',i.customer_name,
 'business',i.business_name,'store',i.store_name,'address',i.customer_snapshot->>'address',
 'business_address',b.document_address,'business_contact',concat_ws(' · ',b.document_phone,b.document_email),
 'summary',coalesce(i.note,'Customer invoice'),'total',i.total,'outstanding',v.outstanding,'payment_status',v.status,
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('description',l.product_name,'quantity',l.quantity,'unit',l.unit,'price',l.unit_price,'amount',l.line_total) order by l.id),'[]') from public.sales_invoice_items l where l.invoice_id=i.id),
 'details',jsonb_build_object('Subtotal',i.subtotal,'Discount',i.discount,'Tax',i.tax_amount,'Payments received',v.paid,'Credit notes',v.credits,'Debit notes',v.debits))
 from public.sales_invoices i join public.v_invoice_balances v on v.id=i.id join public.sales_orders o on o.id=i.order_id join public.businesses b on b.id=i.business_id where i.id=p_invoice
$$;
revoke all on function app_private.customer_invoice_document(uuid) from public,anon,authenticated;

-- Deferred events see all line items and financial entries from the completed transaction.
create function app_private.customer_document_event() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid;s uuid;actor uuid;mod text;k text;doc jsonb;lines jsonb;extra jsonb;inv uuid;r record;amount numeric;
begin
 -- Most sales are walk-in or not opted in: do no document enrichment for them.
 case tg_table_name
  when 'invoice_entries' then select customer_id into c from public.sales_invoices where id=new.invoice_id;
  when 'customer_refunds' then select customer_id into c from public.goods_returns where id=new.return_id;
  when 'credit_transactions' then select customer_id into c from public.credit_accounts where id=new.credit_account_id;
  when 'delivery_events' then select i.customer_id into c from public.order_deliveries d join public.sales_invoices i on i.id=d.invoice_id where d.id=new.delivery_id;
  else c:=new.customer_id;
 end case;
 if c is null or not exists(select 1 from public.customers where id=c and email_notifications and is_active) then return new;end if;
 if tg_table_name='sales_orders' then
  if new.status='DRAFT' or (tg_op='UPDATE' and old.status=new.status) then return new;end if;
  c:=new.customer_id;s:=new.store_id;actor:=coalesce(auth.uid(),new.cancelled_by,new.created_by);mod:='orders_recent';k:='order-'||new.id||'-'||new.status;
  select coalesce(jsonb_agg(jsonb_build_object('description',product_name,'quantity',quantity,'unit',unit,'price',unit_price,'amount',line_total) order by id),'[]'),coalesce(sum(line_total),0) into lines,amount from public.sales_order_items where order_id=new.id;
  amount:=round((amount-coalesce(new.quoted_discount,0))*(1+coalesce(new.quoted_tax_percent,0)/100),2);
  doc:=jsonb_build_object('type',case when new.status='CANCELLED' then 'Order cancellation' else 'Order confirmation' end,'reference',new.reference,'date',coalesce(new.cancelled_at,new.confirmed_at,new.created_at),'summary',coalesce(new.cancellation_reason,new.note,'Order confirmed'),'total',amount,'payment_status','See invoice','lines',lines);
 elsif tg_table_name='sales_invoices' then
  if new.goods_issued_at is null or old.goods_issued_at is not null then return new;end if;
  c:=new.customer_id;s:=new.store_id;actor:=new.goods_issued_by;mod:='invoices_view_invoices';k:='goods-release-'||new.id;
  doc:=app_private.customer_invoice_document(new.id)||jsonb_build_object('type','Goods Out','date',new.goods_issued_at,'summary','Goods released against invoice '||new.reference);
 elsif tg_table_name='invoice_entries' then
  if new.kind='ISSUE' or exists(select 1 from public.goods_returns where credit_entry_id=new.id) then return new;end if;
  select customer_id into c from public.sales_invoices where id=new.invoice_id and store_id=new.store_id;
  s:=new.store_id;actor:=new.performed_by;mod:='invoices_view_invoices';k:='invoice-entry-'||new.id;
  doc:=app_private.customer_invoice_document(new.invoice_id)||jsonb_build_object('type',case new.kind when 'PAYMENT' then 'Payment receipt' when 'CREDIT_NOTE' then 'Credit note' when 'DEBIT_NOTE' then 'Debit note' else 'Invoice cancellation' end,
  'reference',new.reference,'related_reference',(select reference from public.sales_invoices where id=new.invoice_id),'date',new.created_at,'total',new.amount,'summary',concat_ws(' · ',replace(new.kind,'_',' '),new.method,new.payment_reference,new.reason),
  'lines',jsonb_build_array(jsonb_build_object('description',concat_ws(' · ',replace(new.kind,'_',' '),new.method,new.reason),'amount',new.amount)));
 elsif tg_table_name='goods_out' then
  c:=new.customer_id;s:=new.store_id;actor:=new.performed_by;mod:='goods_out';k:='receipt-'||new.id;
  select * into r from public.goods_out where id=new.id;
  select snapshot into extra from public.sale_receipts where sale_id=new.id;
  select coalesce(jsonb_agg(jsonb_build_object('description',p.name,'quantity',l.quantity,'unit',p.unit,'price',l.unit_price,'amount',l.line_total) order by l.id),'[]') into lines from public.goods_out_items l join public.products p on p.id=l.product_id where goods_out_id=new.id;
  if extra is not null then select jsonb_agg(jsonb_build_object('description',v->>'name','quantity',v->'quantity','unit',v->>'unit','price',v->'unit_price','amount',v->'total')) into lines from jsonb_array_elements(extra->'items') v;end if;
  doc:=jsonb_build_object('type','Goods Out / sales receipt','reference',coalesce(extra->>'reference','POS-'||upper(replace(new.id::text,'-',''))),'date',new.created_at,'total',r.total_amount,'summary',coalesce(new.note,'Sale completed'),
  'payment_status',case when new.sale_type='CREDIT' then 'Credit' else 'Paid' end,'outstanding',case when new.sale_type='CREDIT' then r.total_amount else 0 end,'lines',lines,
  'details',jsonb_build_object('Payment method',new.sale_type,'Payment reference',new.payment_reference,'Cash received',extra->'cash_tendered','Change',extra->'change','Payments',extra->'payments'));
 elsif tg_table_name='goods_returns' then
  if new.status<>'APPROVED' or (tg_op='UPDATE' and old.status='APPROVED') then return new;end if;
  c:=new.customer_id;s:=new.store_id;actor:=coalesce(new.approved_by,new.created_by);mod:='returns';k:='return-'||new.id;
  select coalesce(jsonb_agg(jsonb_build_object('description',l.product_name,'quantity',l.quantity,'amount',l.amount) order by l.id),'[]') into lines from public.goods_return_items l where l.return_id=new.id;
  doc:=jsonb_build_object('type','Return / credit note','reference',new.reference,'related_reference',coalesce((select reference from public.sales_invoices where id=new.invoice_id),(select reference from public.sale_receipts where sale_id=new.sale_id)),
  'date',new.processed_at,'summary',new.reason,'total',new.amount,'payment_status','Credit approved','lines',lines);
 elsif tg_table_name='customer_refunds' then
  select customer_id,reference into r from public.goods_returns where id=new.return_id and store_id=new.store_id;
  c:=r.customer_id;s:=new.store_id;actor:=new.performed_by;mod:='returns';k:='refund-'||new.id;
  doc:=jsonb_build_object('type','Refund receipt','reference',new.reference,'related_reference',r.reference,'date',new.created_at,'summary',concat_ws(' · ',new.reason,new.method,new.payment_reference),'total',new.amount,'payment_status','Refund paid','lines',jsonb_build_array(jsonb_build_object('description',new.reason,'amount',new.amount)));
 elsif tg_table_name='credit_transactions' then
  if new.txn_type='CREDIT_SALE' or coalesce(new.reference_table,'') in ('invoice_entries','goods_returns','customer_refunds','store_credit_allocations','goods_out') then return new;end if;
  select customer_id into c from public.credit_accounts where id=new.credit_account_id and store_id=new.store_id;
  s:=new.store_id;actor:=new.performed_by;mod:='credit';k:='account-entry-'||new.id;
  doc:=jsonb_build_object('type',case when new.txn_type='PAYMENT' then 'Account payment receipt' else 'Account adjustment' end,'reference','ACC-'||upper(replace(new.id::text,'-','')),'date',new.created_at,'summary',coalesce(new.note,replace(new.txn_type::text,'_',' ')),
  'total',abs(new.amount),'outstanding',greatest(new.balance_after,0),'payment_status',case when new.balance_after>0 then 'Outstanding' when new.balance_after<0 then 'Account in credit' else 'Settled' end,'lines',jsonb_build_array(jsonb_build_object('description',coalesce(new.note,new.txn_type::text),'amount',new.amount)), 'details',jsonb_build_object('Account balance',new.balance_after));
 elsif tg_table_name='delivery_events' then
  if new.action not in ('generated','dispatch','complete','fail','reschedule','cancel','cancel_order') then return new;end if;
  select * into r from public.order_deliveries where id=new.delivery_id;
  select customer_id into c from public.sales_invoices where id=r.invoice_id and store_id=r.store_id;
  s:=r.store_id;actor:=new.actor_id;mod:='orders_deliveries';k:='delivery-event-'||new.id;
  select coalesce(jsonb_agg(jsonb_build_object('description',concat_ws(' · ',l->>'description',l->>'sku',l->>'barcode','Ordered: '||(l->>'ordered_quantity'),l->>'remarks'),'quantity',l->'delivery_quantity','unit',l->>'unit')),'[]') into lines from jsonb_array_elements(r.snapshot->'items') l;
  doc:=app_private.customer_invoice_document(r.invoice_id)||jsonb_build_object('type','Delivery note','reference',r.reference,'related_reference',concat_ws(' / ',r.snapshot->>'order_reference',r.snapshot->>'invoice_reference'),'date',new.created_at,'summary','Delivery '||replace(r.status,'_',' '),'lines',lines,
  'details',jsonb_build_object('Delivery address',r.snapshot->>'delivery_address','Customer contact',r.snapshot->>'contact_number','Customer code',r.snapshot->>'customer_code','Original delivery date',r.original_date,'Scheduled delivery date',r.scheduled_date,'Driver',r.driver_name,'Vehicle',r.vehicle_registration,'Delivery reference',r.delivery_reference,'Delivered at',r.delivered_at,'Received by',r.received_by,'Receiver contact',r.receiver_phone,'Cancellation reason',r.cancellation_reason,'Comments',coalesce(new.notes,r.comments),'Receiver signature','________________________','Driver signature','________________________'));
 elsif tg_table_name='sales_quotes' then
  if new.status<>'SENT' or (tg_op='UPDATE' and old.status='SENT') then return new;end if;
  c:=new.customer_id;s:=new.store_id;actor:=coalesce(auth.uid(),new.created_by);mod:='invoices_view_quotes';k:='quote-'||new.id;
  select coalesce(jsonb_agg(jsonb_build_object('description',coalesce(v->>'name',v->>'product_name'),'quantity',v->'quantity','price',v->'unit_price','amount',(v->>'quantity')::numeric*(v->>'unit_price')::numeric)),'[]') into lines from jsonb_array_elements(new.items) v;
  doc:=jsonb_build_object('type','Quotation','reference',new.reference,'date',new.created_at,'due',new.valid_until,'summary',coalesce(new.note,'Quotation issued'),'total',new.total,'payment_status','Not yet invoiced','lines',lines,'details',jsonb_build_object('Valid until',new.valid_until));
 else return new;end if;
 perform app_private.queue_customer_document(c,s,actor,mod,k,doc);
 return new;
end $$;
revoke all on function app_private.customer_document_event() from public,anon,authenticated;
create constraint trigger customer_order_email after insert or update on public.sales_orders deferrable initially deferred for each row execute function app_private.customer_document_event();
create constraint trigger customer_goods_release_email after update on public.sales_invoices deferrable initially deferred for each row execute function app_private.customer_document_event();
create constraint trigger customer_invoice_entry_email after insert on public.invoice_entries deferrable initially deferred for each row execute function app_private.customer_document_event();
create constraint trigger customer_sale_email after insert on public.goods_out deferrable initially deferred for each row execute function app_private.customer_document_event();
create constraint trigger customer_return_email after insert or update on public.goods_returns deferrable initially deferred for each row execute function app_private.customer_document_event();
create constraint trigger customer_refund_email after insert on public.customer_refunds deferrable initially deferred for each row execute function app_private.customer_document_event();
create constraint trigger customer_account_email after insert on public.credit_transactions deferrable initially deferred for each row execute function app_private.customer_document_event();
create constraint trigger customer_quote_email after insert or update on public.sales_quotes deferrable initially deferred for each row execute function app_private.customer_document_event();
-- Delivery event is inserted after its full note is saved; snapshot each version immediately.
create trigger customer_delivery_email after insert on public.delivery_events for each row execute function app_private.customer_document_event();

create function public.queue_customer_statement(p_customer uuid,p_request uuid,p_from date,p_to date) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.customers%rowtype;a public.credit_accounts%rowtype;doc jsonb;j uuid;lo timestamptz;hi timestamptz;opening numeric;closing numeric;n int;
begin
 select * into c from public.customers where id=p_customer;
 if c.id is null or auth.uid() is null or not app.has_store_access(c.store_id) or not app.has_module(c.store_id,'credit') then raise exception 'FORBIDDEN';end if;
 if not c.email_notifications or not c.is_active or nullif(c.email::text,'') is null then raise exception 'CUSTOMER_EMAIL_DISABLED';end if;
 if p_request is null or p_from is null or p_to is null or p_from>p_to or p_to-p_from>366 then raise exception 'STATEMENT_DATE_RANGE';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,2909));
 select id,document into j,doc from public.customer_document_notifications where event_key='statement-'||p_request;
 if j is not null then
  if (doc->>'customer_id')::uuid<>c.id or doc->>'from'<>p_from::text or doc->>'to'<>p_to::text then raise exception 'REQUEST_CHANGED';end if;return j;
 end if;
 select * into a from public.credit_accounts where customer_id=c.id;
 select p_from::timestamp at time zone timezone,(p_to+1)::timestamp at time zone timezone into lo,hi from public.stores where id=c.store_id;
 select coalesce(sum(amount),0) into opening from public.credit_transactions where credit_account_id=a.id and created_at<lo;
 select count(*),opening+coalesce(sum(amount),0),coalesce(jsonb_agg(jsonb_build_object('description',concat_ws(' · ',to_char(created_at at time zone (select timezone from public.stores where id=c.store_id),'YYYY-MM-DD HH24:MI'),replace(txn_type::text,'_',' '),note),'amount',amount,'balance',balance_after) order by created_at,id),'[]') into n,closing,doc from public.credit_transactions where credit_account_id=a.id and created_at>=lo and created_at<hi;
 if n>10000 then raise exception 'STATEMENT_TOO_LARGE';end if;
 return app_private.queue_customer_document(c.id,c.store_id,auth.uid(),'credit','statement-'||p_request,jsonb_build_object('customer_id',c.id,'from',p_from,'to',p_to,'type','Customer statement','reference','STMT-'||to_char(p_to,'YYYYMMDD')||'-'||upper(left(p_request::text,8)),'date',now(),'summary','Account statement: '||p_from||' to '||p_to,'total',closing,'outstanding',greatest(closing,0),'payment_status',case when closing>0 then 'Outstanding' when closing<0 then 'Account in credit' else 'Settled' end,'lines',doc,'details',jsonb_build_object('Opening balance',opening,'Closing balance',closing,'Amount sign','Positive increases the balance; negative reduces it')));
end $$;
revoke all on function public.queue_customer_statement(uuid,uuid,date,date) from public,anon;
grant execute on function public.queue_customer_statement(uuid,uuid,date,date) to authenticated;

create function public.claim_customer_documents(p_limit int default 5) returns jsonb language plpgsql security definer set search_path='' as $$
declare j record;t uuid;result jsonb:='[]';claims text:=current_setting('request.jwt.claims',true);sub text:=current_setting('request.jwt.claim.sub',true);
begin
 if coalesce(nullif(claims,'')::jsonb->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 update public.customer_document_notifications set state='UNCERTAIN',last_error='Delivery confirmation missing. Review before sending again.' where state='PROCESSING' and claimed_at<now()-interval '15 minutes';
 for j in select * from public.customer_document_notifications where state='PENDING' and available_at<=now() order by available_at,id limit greatest(1,least(coalesce(p_limit,5),5)) for update skip locked loop
  perform set_config('request.jwt.claim.sub',coalesce(j.authorized_by::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',j.authorized_by,'role','authenticated')::text,true);
  if not exists(select 1 from public.customers where id=j.customer_id and store_id=j.store_id and business_id=j.business_id and is_active and email_notifications and lower(email::text)=lower(j.recipient)) then
   update public.customer_document_notifications set state='SKIPPED',last_error='Customer notifications disabled or contact changed.' where id=j.id;
  elsif auth.uid() is null or not app.has_store_access(j.store_id) or not app.has_module(j.store_id,j.module) then
   update public.customer_document_notifications set state='SKIPPED',last_error='Transaction user no longer has document access.' where id=j.id;
  else
   t:=gen_random_uuid();update public.customer_document_notifications set state='PROCESSING',token=t,claimed_at=now(),attempts=attempts+1 where id=j.id;
   result:=result||jsonb_build_array(jsonb_build_object('id',j.id,'token',t,'recipient',j.recipient,'document',j.document));
  end if;
 end loop;
 perform set_config('request.jwt.claims',coalesce(claims,''),true);perform set_config('request.jwt.claim.sub',coalesce(sub,''),true);
 return result;
end $$;
create function public.complete_customer_document(p_id uuid,p_token uuid,p_outcome text,p_provider text default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'FORBIDDEN';end if;
 if p_outcome not in ('SENT','UNCERTAIN','PREPARATION_FAILED') or p_outcome is null or (p_outcome='SENT' and nullif(p_provider,'') is null) then raise exception 'INVALID_DELIVERY';end if;
 update public.customer_document_notifications set state=case when p_outcome='PREPARATION_FAILED' then case when attempts<3 then 'PENDING' else 'FAILED' end else p_outcome end,
 available_at=now()+interval '5 minutes',provider=p_provider,sent_at=case when p_outcome='SENT' then now() end,
 last_error=case p_outcome when 'PREPARATION_FAILED' then 'Document could not be prepared.' when 'UNCERTAIN' then 'Email acceptance unconfirmed. Review before sending again.' end
 where id=p_id and token=p_token and state='PROCESSING';
 if not found then raise exception 'INVALID_RESERVATION';end if;
end $$;
revoke all on function public.claim_customer_documents(int),public.complete_customer_document(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_customer_documents(int),public.complete_customer_document(uuid,uuid,text,text) to service_role;

-- Keep one invoice delivery path, including recurring/manual invoices. Consent source
-- distinguishes explicit scheduled sends from customer profile automation.
alter table public.recurring_invoice_deliveries add column consent_source text not null default 'explicit' check(consent_source in ('explicit','customer'));
create or replace function app_private.queue_customer_invoice() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient text;source text;actor uuid:=auth.uid();
begin
 if new.state='ISSUED' and old.state is distinct from 'ISSUED' then
  select case when r.auto_email then r.recipient when c.auto_email_invoices or c.email_notifications then c.email::text end,case when r.auto_email then 'explicit' else 'customer' end into recipient,source
  from public.customers c left join public.recurring_invoices r on r.id=new.recurring_schedule_id where c.id=new.customer_id and c.store_id=new.store_id and c.is_active;
  if nullif(recipient,'') is not null and actor is not null then
   insert into public.recurring_invoice_deliveries(invoice_id,store_id,recipient,authorized_by,consent_source) values(new.id,new.store_id,recipient,actor,source) on conflict do nothing;
  end if;
 end if;return new;
end $$;
do $$ declare definition text;begin
 select pg_get_functiondef('public.send_manual_recurring_invoice(uuid,uuid,bigint,jsonb,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'authorized_by=excluded.authorized_by','authorized_by=excluded.authorized_by,consent_source=''explicit''');execute definition;
 select pg_get_functiondef('public.claim_recurring_deliveries(int)'::regprocedure) into definition;
 definition:=replace(definition,'if (auth.uid()', 'if (j.consent_source=''customer'' and not exists(select 1 from public.customers c join public.sales_invoices i on i.customer_id=c.id where i.id=j.invoice_id and c.store_id=j.store_id and c.is_active and (c.auto_email_invoices or c.email_notifications) and lower(c.email::text)=lower(j.recipient))) or (auth.uid()');
 definition:=replace(definition,'''logo_path'',','''document'',app_private.customer_invoice_document(i.id),''logo_path'',');execute definition;
 select pg_get_functiondef('public.smtp_delivery(text,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'recurring-[0-9a-f-]{36}|','customer-[0-9a-f-]{36}|recurring-[0-9a-f-]{36}|');execute definition;
 select pg_get_functiondef('public.app_schema_status()'::regprocedure) into definition;
 definition:=regexp_replace(definition,'''capabilities''\s*,\s*jsonb_build_object\(','''capabilities'',jsonb_build_object(''customer_notifications_v1'',true,');execute definition;
end $$;
-- Reuse the existing encrypted worker credential; no secrets enter migration history.
create function public.customer_email_history(p_customer uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.customers%rowtype;result jsonb;
begin
 select * into c from public.customers where id=p_customer;
 if c.id is null or auth.uid() is null or not app.has_store_access(c.store_id) or not app.has_module(c.store_id,'credit') then raise exception 'FORBIDDEN';end if;
 select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id),'[]') into result from (
  select * from (
   select d.id,d.document->>'type' as type,d.document->>'reference' as reference,d.state,d.created_at,d.sent_at,d.last_error as error
   from public.customer_document_notifications d where d.customer_id=c.id and d.store_id=c.store_id and app.has_module(c.store_id,d.module)
   union all
   select d.invoice_id,'Invoice',i.reference,d.state,d.created_at,d.sent_at,d.last_error from public.recurring_invoice_deliveries d join public.sales_invoices i on i.id=d.invoice_id
   where i.customer_id=c.id and d.store_id=c.store_id and app.has_module(c.store_id,'invoices_view_invoices')
  ) all_emails order by created_at desc,id limit 50
 ) h;
 return result;
end $$;
revoke all on function public.customer_email_history(uuid) from public,anon;
grant execute on function public.customer_email_history(uuid) to authenticated;

do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') and to_regclass('vault.secrets') is not null then
  perform cron.schedule('customer-document-email','* * * * *',$job$
   select net.http_post(url:='https://uagswjbtipvlyeychfyb.supabase.co/functions/v1/customer-notifications',
   headers:=jsonb_build_object('Content-Type','application/json','x-recurring-secret',(select decrypted_secret from vault.decrypted_secrets where name='pos_recurring_worker_secret')),
   body:='{}'::jsonb,timeout_milliseconds:=120000);
  $job$);
 end if;
end $$;
