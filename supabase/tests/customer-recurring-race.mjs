import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Real concurrent connections, restricted to disposable local databases.
export async function testRecurringRace(url) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Local database required");
  const clients = Array.from(
    { length: 5 },
    () => new pg.Client({ connectionString: url }),
  );
  await Promise.all(clients.map((c) => c.connect()));
  const [a] = clients;
  try {
    const user = randomUUID();
    await a.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')",
      [user, `recurring-race-${user}@test.invalid`],
    );
    for (const c of clients) {
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: "authenticated" }),
      ]);
      await c.query("set statement_timeout='20s'");
    }
    const {
      rows: [{ r }],
    } = await a.query(
      "select public.create_business('Recurring race','Shop') r",
    );
    const {
      rows: [{ id: customer }],
    } = await a.query(
      "insert into public.customers(business_id,store_id,name) values($1,$2,'Race customer') returning id",
      [r.business_id, r.store_id],
    );
    const {
      rows: [{ id: product }],
    } = await a.query(
      "select public.create_product($1,'Race service',null,null,null,1,2) id",
      [r.store_id],
    );
    const lines = JSON.stringify([{ product_id: product, quantity: 1 }]);
    const orders = await Promise.all(
      clients.map((c) =>
        c.query("select public.create_sales_order($1,$2,$3::jsonb,$4) id", [
          r.store_id,
          customer,
          lines,
          randomUUID(),
        ]),
      ),
    );
    const { rows: refs } = await a.query(
      "select reference from public.sales_orders where id=any($1::uuid[]) order by reference",
      [orders.map((o) => o.rows[0].id)],
    );
    assert.equal(new Set(refs.map((r) => r.reference)).size, 5);
    assert.deepEqual(
      refs.map((r) => Number(r.reference.split("-").at(-1))),
      [1, 2, 3, 4, 5],
    );
    const {
      rows: [{ today }],
    } = await a.query(
      "select to_char(now() at time zone 'Africa/Johannesburg','YYYY-MM-DD') today",
    );
    const schedule = randomUUID();
    await a.query("select public.save_recurring_invoice($1,$2,0,$3::jsonb)", [
      r.store_id,
      schedule,
      JSON.stringify({
        title: "Concurrent billing",
        customer_id: customer,
        frequency: "MONTHLY",
        start_date: today,
        next_date: today,
        end_date: null,
        due_days: 30,
        terms: "CASH",
        tax_percent: 0,
        recipient: "",
        auto_email: false,
        active: true,
        items: [{ product_id: product, quantity: 1, unit_price: 2 }],
      }),
    ]);
    const results = await Promise.all(
      clients.map((c) =>
        c.query("select app_private.generate_recurring_invoice($1) id", [
          schedule,
        ]),
      ),
    );
    assert.equal(results.filter((r) => r.rows[0].id !== null).length, 1);
    const {
      rows: [{ count }],
    } = await a.query(
      "select count(*)::int count from public.sales_invoices where recurring_schedule_id=$1",
      [schedule],
    );
    assert.equal(count, 1);
    console.log(
      "Passed concurrent document numbering and recurring invoice generation",
    );
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}
