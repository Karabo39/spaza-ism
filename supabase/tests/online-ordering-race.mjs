import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
export async function testOnlineOrderingRace(url) {
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
    throw Error("Local database required");
  const a = new pg.Client({ connectionString: url }),
    b = new pg.Client({ connectionString: url });
  await Promise.all([a.connect(), b.connect()]);
  const user = randomUUID();
  try {
    await a.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,'online-race@test.invalid','{}')",
      [user],
    );
    const claims = JSON.stringify({ sub: user, role: "authenticated" });
    for (const c of [a, b])
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        claims,
      ]);
    const {
      rows: [created],
    } = await a.query(
      "select public.create_business('Online race','Shop') result",
    );
    const store = created.result.store_id;
    const {
      rows: [product],
    } = await a.query(
      "select public.create_product($1,'Last parcel','LAST-PARCEL',null,null,1,10) id",
      [store],
    );
    await a.query("select public.receive_stock($1,null,null,null,$2)", [
      store,
      JSON.stringify([{ product_id: product.id, quantity: 1 }]),
    ]);
    const {
      rows: [settings],
    } = await a.query("select public.online_settings($1) result", [store]);
    const link = settings.result.link_token;
    await a.query("select public.save_online_ordering_settings($1,1,$2)", [
      store,
      JSON.stringify({
        enabled: true,
        collection_enabled: true,
        delivery_enabled: false,
        pay_on_collection: true,
        delivery_fee: 0,
        payment_instructions: "Test bank",
        reservation_hours: 24,
        notifications_enabled: false,
      }),
    ]);
    await a.query(
      "select public.save_product_online($1,(select updated_at from public.products where id=$1),$2)",
      [product.id, JSON.stringify({ available_online: true })],
    );
    await a.query(
      "select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)",
    );
    const place = () =>
      a.query(
        "select public.place_customer_order($1,$2,$3,$4,$5,'COLLECTION',current_date,'PAY_ON_COLLECTION')",
        [
          link,
          randomUUID(),
          "a".repeat(64),
          JSON.stringify({ name: "Buyer", phone: "123" }),
          JSON.stringify([{ product_id: product.id, quantity: 1 }]),
        ],
      );
    await a.query("begin");
    await place();
    // POS waits on the stock row held by placement. Its trigger must see the newly committed reservation.
    const pos = b.query(
      "select public.complete_checkout($1,$2,$4,$3,null,false)",
      [
        store,
        JSON.stringify([
          { product_id: product.id, quantity: 1, unit_price: 10 },
        ]),
        randomUUID(),
        JSON.stringify([{ method: "CASH", amount: 10 }]),
      ],
    );
    const outcome = pos.then(
      () => ({ ok: true }),
      (error) => ({ ok: false, message: error.message }),
    );
    await a.query("commit");
    const result = await outcome;
    assert.equal(result.ok, false);
    assert.equal(result.message, "STOCK_RESERVED_ONLINE");
    const {
      rows: [balance],
    } = await a.query("select quantity from public.stock where product_id=$1", [
      product.id,
    ]);
    assert.equal(Number(balance.quantity), 1);
    // Reverse: a POS sale commits before placement acquires the product/stock locks.
    await a.query(
      "update public.sales_orders set status='CANCELLED',cancellation_reason='Test reset' where store_id=$1",
      [store],
    );
    await b.query("begin");
    await b.query("select public.complete_checkout($1,$2,$4,$3,null,false)", [
      store,
      JSON.stringify([{ product_id: product.id, quantity: 1, unit_price: 10 }]),
      randomUUID(),
      JSON.stringify([{ method: "CASH", amount: 10 }]),
    ]);
    const next = place().then(
      () => ({ ok: true }),
      (error) => ({ ok: false, message: error.message }),
    );
    await b.query("commit");
    const rejected = await next;
    assert.equal(rejected.ok, false);
    assert.equal(rejected.message, "PRODUCT_UNAVAILABLE");
    console.log(
      "Passed online reservations versus POS checkout in both lock orders",
    );
  } finally {
    await Promise.all([a.end(), b.end()]);
  }
}
