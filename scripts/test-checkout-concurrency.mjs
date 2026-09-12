import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
const url=process.env.BRD_TEST_DATABASE_URL;if(!url || new URL(url).hostname!=='127.0.0.1')throw Error('Use a disposable local test database');
const clients=Array.from({length:3},()=>new pg.Client({connectionString:url}));await Promise.all(clients.map(c=>c.connect()));const [admin,a,b]=clients;const user=randomUUID();
async function auth(c){await c.query('begin');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:'authenticated'})]);await c.query('set local role authenticated');}
try{
 await admin.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')",[user,user+'@test.invalid']);await auth(admin);
 const loc=(await admin.query("select public.create_business('Checkout concurrency','Test') result")).rows[0].result.store_id;
 const product=(await admin.query("select public.create_product($1,'Product',$2,null,null,1,100) id",[loc,randomUUID()])).rows[0].id;
 await admin.query('select public.receive_stock($1,null,null,null,$2)',[loc,JSON.stringify([{product_id:product,quantity:10}])]);await admin.query('commit');
 const values=[loc,JSON.stringify([{product_id:product,quantity:1,unit_price:100}]),JSON.stringify([{method:'CASH',amount:60},{method:'CARD',amount:50,confirmed:true}]),randomUUID()];
 const sql='select public.complete_checkout($1,$2,$3,$4) id';await auth(a);await auth(b);
 const first=(await a.query(sql,values)).rows[0].id;const second=b.query(sql,values);await a.query('commit');assert.equal((await second).rows[0].id,first);await b.query('commit');
 assert.equal(Number((await admin.query('select quantity from public.stock where product_id=$1',[product])).rows[0].quantity),9);
 assert.equal(Number((await admin.query('select sum(amount) n from public.sale_payments where sale_id=$1',[first])).rows[0].n),100);
 console.log('Concurrent retries: one sale, one stock deduction, balanced payments');
}finally{await Promise.all(clients.map(c=>c.end()));}
