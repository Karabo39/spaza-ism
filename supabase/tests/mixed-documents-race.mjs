import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function testMixedDocumentsRace(url) {
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
      [user, `mixed-race-${user}@test.invalid`],
    );
    for (const c of clients) {
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: "authenticated" }),
      ]);
      await c.query("set role authenticated");
      await c.query("set statement_timeout='20s'");
    }
    const {
      rows: [{ r }],
    } = await a.query(
      "select public.create_business('Mixed number race','Shop') r",
    );
    const {
      rows: [{ id: wh }],
    } = await a.query(
      "select public.create_location($1,'Warehouse','warehouse') id",
      [r.business_id],
    );
    const {
      rows: [{ id: product }],
    } = await a.query(
      "select public.create_product($1,'Race product',null,null,null,1,10) id",
      [r.store_id],
    );
    const {
      rows: [{ id: source }],
    } = await a.query(
      "select public.create_product($1,'Race product',null,null,null,1,10) id",
      [wh],
    );
    await a.query("select public.receive_stock($1,null,null,null,$2)", [
      r.store_id,
      JSON.stringify([{ product_id: product, quantity: 20 }]),
    ]);
    const items = JSON.stringify([
      { product_id: product, quantity: 1, unit_price: 10 },
    ]);
    const pay = '[{"method":"CASH","amount":10}]';
    const request = randomUUID();
    const replay = await Promise.all(
      clients.map((c) =>
        c.query("select public.complete_checkout($1,$2,$3,$4) id", [
          r.store_id,
          items,
          pay,
          request,
        ]),
      ),
    );
    assert.equal(
      new Set(replay.map((x) => x.rows[0].id)).size,
      1,
      "Concurrent checkout replay creates one receipt",
    );
    await Promise.all(
      clients.map((c) =>
        c.query("select public.complete_checkout($1,$2,$3,$4) id", [
          r.store_id,
          items,
          pay,
          randomUUID(),
        ]),
      ),
    );
    const { rows: receipts } = await a.query(
      "select reference,snapshot->>'reference' snapshot_reference from public.sale_receipts where store_id=$1 order by reference",
      [r.store_id],
    );
    assert.deepEqual(
      receipts.map((r) => Number(r.reference.split("-").at(-1))),
      [1, 2, 3, 4, 5, 6],
    );
    assert.ok(
      receipts.every(
        (r) =>
          /^POS-\d{8}-\d{3}$/.test(r.reference) &&
          r.reference === r.snapshot_reference,
      ),
    );
    const lines = JSON.stringify([
      {
        source_product_id: source,
        destination_product_id: product,
        quantity: 1,
      },
    ]);
    const transferRequest = randomUUID();
    const transfers = await Promise.all(
      clients.map((c) =>
        c.query("select public.create_stock_transfer($1,$2,$3,$4) id", [
          wh,
          r.store_id,
          lines,
          transferRequest,
        ]),
      ),
    );
    assert.equal(new Set(transfers.map((x) => x.rows[0].id)).size, 1);
    await Promise.all(
      clients.map((c) =>
        c.query("select public.create_stock_transfer($1,$2,$3,$4) id", [
          wh,
          r.store_id,
          lines,
          randomUUID(),
        ]),
      ),
    );
    const { rows: refs } = await a.query(
      "select reference from public.stock_transfers where business_id=$1 order by reference",
      [r.business_id],
    );
    assert.deepEqual(
      refs.map((r) => Number(r.reference.split("-").at(-1))),
      [1, 2, 3, 4, 5, 6],
    );
    assert.ok(refs.every((r) => /^TR-\d{8}-\d{3}$/.test(r.reference)));
    console.log("Passed concurrent POS/TR numbering and retry replay");
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}
