import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.BRD_TEST_DATABASE_URL;
if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Use a disposable local test database.");
const clients = Array.from({ length: 3 }, () => new pg.Client({ connectionString: url }));
await Promise.all(clients.map((c) => c.connect()));
const [admin, a, b] = clients;
const owner = randomUUID(), employee = randomUUID();
async function begin(client, user = owner) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  await client.query("set local role authenticated");
}
async function asUser(client, action) {
  await begin(client);
  try { const result = await action(client); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback"); throw error; }
}
const scalar = async (client, sql, values = []) => Object.values((await client.query(sql, values)).rows[0])[0];
try {
  await admin.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}'),($3,$4,'{}')", [owner, "owner-" + owner + "@test.invalid", employee, "staff-" + employee + "@test.invalid"]);
  const setup = await asUser(admin, async (c) => {
    const created = await scalar(c, "select public.create_business('Concurrency fixture','Test till')");
    const loc = created.store_id, biz = created.business_id;
    const member = await scalar(c, "select public.add_member_by_email($1,$2,'employee')", [biz, "staff-" + employee + "@test.invalid"]);
    await c.query("select public.set_member_locations($1,array[$2]::uuid[])", [member, loc]);
    const product = await scalar(c, "select public.create_product($1,'Test stock',$2,null,null,5,10)", [loc, randomUUID()]);
    await c.query("select public.receive_stock($1,null,null,null,$2)", [loc, JSON.stringify([{ product_id: product, quantity: 50 }])]);
    const customer = await scalar(c, "insert into public.customers(business_id,store_id,name) values($1,$2,'Test customer') returning id", [biz, loc]);
    await c.query("select public.set_credit_limit($1,1000)", [customer]);
    await c.query("select public.complete_sale($1,'CREDIT',$2,$3)", [loc, customer, JSON.stringify([{ product_id: product, quantity: 5 }])]);
    const day = await scalar(c, "select (now() at time zone 'Africa/Johannesburg')::date::text");
    return { biz, loc, member, product, customer, day };
  });
  const { loc, member, product, customer, day } = setup;
  const changes = await Promise.allSettled([a, b].map((c) => asUser(c, () => scalar(c, "select public.set_store_module_access($1,$2,'{\"goods_out\":false}',0)", [member, loc]))));
  assert.equal(changes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(changes.find((r) => r.status === "rejected").reason.message, "ACCESS_CHANGED_REFRESH");
  console.log("Passed concurrent permission editors: stale save rejected");

  const request = randomUUID();
  const payments = await Promise.all([a, b].map((c) => asUser(c, () => scalar(c, "select public.record_credit_payment_tender($1,10,'CASH',$2)", [customer, request]))));
  assert.equal(payments[0], payments[1]);
  console.log("Passed concurrent payment retries: one receipt");
  const cashUp = await asUser(a, () => scalar(a, "select public.open_cash_up($1,$2,20)", [loc, day]));
  let summary = await asUser(a, () => scalar(a, "select public.cash_up_summary($1,$2)", [loc, day]));
  assert.equal(summary.expected, 30);
  const submission = await asUser(a, () => scalar(a, "select public.submit_cash_up($1,30,'{}',$2,'',$3)", [cashUp, summary.count_token, randomUUID()]));

  await begin(a);
  await a.query("select public.complete_sale($1,'CASH',null,$2)", [loc, JSON.stringify([{ product_id: product, quantity: 1 }])]);
  const review = asUser(b, () => b.query("select public.review_cash_up($1,$2,'APPROVE','Checked')", [cashUp, submission])).then(() => ({ ok: true }), (error) => ({ error: error.message }));
  let waiting = false;
  for (let i = 0; i < 100; i++) {
    const blockedBy = await scalar(admin, "select pg_blocking_pids($1)", [b.processID]);
    if (blockedBy.includes(a.processID)) { waiting = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(waiting, true, "Approval must wait for the in-flight sale");
  await a.query("commit");
  assert.deepEqual(await review, { error: "CASH_ACTIVITY_CHANGED" });
  console.log("Passed sale versus approval: waited for commit and rejected stale count");

  await asUser(a, () => a.query("select public.review_cash_up($1,$2,'REOPEN','Late sale')", [cashUp, submission]));
  summary = await asUser(a, () => scalar(a, "select public.cash_up_summary($1,$2)", [loc, day]));
  const submits = await Promise.allSettled([a, b].map((c) => asUser(c, () => scalar(c, "select public.submit_cash_up($1,$2,'{}',$3,'',$4)", [cashUp, summary.expected, summary.count_token, randomUUID()]))));
  assert.equal(submits.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(submits.find((r) => r.status === "rejected").reason.message, "CASH_UP_NOT_OPEN");
  console.log("Passed competing counts: one submission, no overwritten count");
} finally {
  // Fixtures remain only in this disposable database for the restore drill.
  await Promise.allSettled(clients.map(async (c) => { await c.query("rollback"); await c.end(); }));
}
