import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function testDeliveryRace(url) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
    throw Error("Local test database required");
  const connections = [
    new pg.Client({ connectionString: url }),
    new pg.Client({ connectionString: url }),
  ];
  await Promise.all(connections.map((c) => c.connect()));
  const [a, b] = connections;
  let business;
  const user = randomUUID();
  try {
    await a.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [user, `delivery-race-${user}@test.invalid`, {}],
    );
    for (const c of connections)
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: "authenticated" }),
      ]);
    const {
      rows: [created],
    } = await a.query(
      "select public.create_business('Delivery race','Shop') result",
    );
    business = created.result.business_id;
    const store = created.result.store_id;
    const {
      rows: [customer],
    } = await a.query(
      "insert into public.customers(business_id,store_id,name) values($1,$2,$3) returning id",
      [business, store, "Buyer"],
    );
    const {
      rows: [product],
    } = await a.query(
      "select public.create_product($1,'Parcel','RACE-DELIVERY',null,null,1,10) id",
      [store],
    );
    const {
      rows: [order],
    } = await a.query("select public.create_sales_order($1,$2,$3,$4) id", [
      store,
      customer.id,
      JSON.stringify([{ product_id: product.id, quantity: 1 }]),
      randomUUID(),
    ]);
    await a.query("select public.process_sales_order($1,'confirm')", [
      order.id,
    ]);
    const {
      rows: [invoice],
    } = await a.query(
      "select public.create_sales_invoice($1,current_date+2,'CASH',0,null) id",
      [order.id],
    );
    await a.query("select public.issue_sales_invoice($1)", [invoice.id]);
    await a.query("set statement_timeout='15s'");
    await b.query("set statement_timeout='15s'");
    const payment = randomUUID();
    await Promise.all([
      a.query(
        "select public.configure_order_delivery($1,0,true,jsonb_build_object('date',current_date+1,'address','Road','phone','123'))",
        [order.id],
      ),
      b.query("select public.post_invoice_entry($1,'PAYMENT',10,$2,'CASH')", [
        invoice.id,
        payment,
      ]),
    ]);
    const {
      rows: [count],
    } = await a.query(
      "select count(*)::int n from public.order_deliveries where invoice_id=$1",
      [invoice.id],
    );
    assert.equal(count.n, 1);
    const {
      rows: [delivery],
    } = await a.query(
      "select id,version from public.order_deliveries where invoice_id=$1",
      [invoice.id],
    );
    const request = randomUUID();
    const args = [
      delivery.id,
      delivery.version,
      JSON.stringify({ date: "2030-01-01", notes: "Concurrent retry" }),
      request,
    ];
    await Promise.all(
      connections.map((c) =>
        c.query(
          "select public.process_delivery($1,$2,'reschedule',$3,$4)",
          args,
        ),
      ),
    );
    const {
      rows: [event],
    } = await a.query(
      "select count(*)::int n from public.delivery_events where request_id=$1",
      [request],
    );
    assert.equal(event.n, 1);
    const {
      rows: [end],
    } = await a.query(
      "select status,version from public.order_deliveries where id=$1",
      [delivery.id],
    );
    assert.equal(end.status, "RESCHEDULED");
    assert.equal(Number(end.version), Number(delivery.version) + 1);
    const invoices = [];
    for (let j = 0; j < 2; j++) {
      const {
        rows: [nextOrder],
      } = await a.query("select public.create_sales_order($1,$2,$3,$4) id", [
        store,
        customer.id,
        JSON.stringify([{ product_id: product.id, quantity: 1 }]),
        randomUUID(),
      ]);
      await a.query(
        "select public.configure_order_delivery($1,0,true,jsonb_build_object('date',current_date+1,'address','Road','phone','123'))",
        [nextOrder.id],
      );
      await a.query("select public.process_sales_order($1,'confirm')", [
        nextOrder.id,
      ]);
      const {
        rows: [nextInvoice],
      } = await a.query(
        "select public.create_sales_invoice($1,current_date+2,'CASH',0,null) id",
        [nextOrder.id],
      );
      await a.query("select public.issue_sales_invoice($1)", [nextInvoice.id]);
      invoices.push(nextInvoice.id);
    }
    await Promise.all(
      connections.map((client, j) =>
        client.query(
          "select public.post_invoice_entry($1,'PAYMENT',10,$2,'CASH')",
          [invoices[j], randomUUID()],
        ),
      ),
    );
    const { rows: references } = await a.query(
      "select reference from public.order_deliveries where business_id=$1 order by reference",
      [business],
    );
    assert.equal(new Set(references.map((r) => r.reference)).size, 3);
    assert(references.every((r) => /^DNN-\d{8}-\d{3}$/.test(r.reference)));
    assert.deepEqual(
      references.map((r) => r.reference.slice(-3)),
      ["001", "002", "003"],
    );
    console.log(
      "Passed concurrent delivery creation, numbering and duplicate action retries",
    );
  } finally {
    await Promise.all(connections.map((c) => c.end()));
  }
}
