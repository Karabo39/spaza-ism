import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Disposable local databases only. Fixtures remain for inspection.
export async function testWarehouseDisableRace(url) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))
    throw new Error("Local database required");
  const clients = [0, 1, 2].map(() => new pg.Client({ connectionString: url }));
  const [a, b, observer] = clients;
  await Promise.all(clients.map((c) => c.connect()));
  try {
    const user = randomUUID();
    await a.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')",
      [user, `race-${user}@test.invalid`],
    );
    for (const c of [a, b]) {
      await c.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: user, role: "authenticated" }),
      ]);
      await c.query("set statement_timeout='10s'");
    }
    const {
      rows: [{ r }],
    } = await a.query(
      "select public.create_business('Warehouse disable race','Shop') r",
    );
    const warehouse = async (name) =>
      (
        await a.query("select public.create_location($1,$2,'warehouse') id", [
          r.business_id,
          name,
        ])
      ).rows[0].id;
    const first = await warehouse("Disable first"),
      second = await warehouse("Receive first");
    const product = async (store) =>
      (
        await a.query(
          "select public.create_product($1,'Race product',null,null,null,1,2) id",
          [store],
        )
      ).rows[0].id;
    const p1 = await product(first),
      p2 = await product(second);
    const pid = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
    async function blocked() {
      for (let i = 0; i < 300; i++) {
        const { rows } = await observer.query(
          "select wait_event_type from pg_stat_activity where pid=$1",
          [pid],
        );
        if (rows[0]?.wait_event_type === "Lock") return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(
        "Concurrent operation did not wait for the warehouse lock",
      );
    }
    await a.query("begin");
    await a.query("select public.disable_warehouse($1)", [first]);
    const lateWrite = b
      .query("update public.stock set quantity=1 where product_id=$1", [p1])
      .then(
        () => "unexpected success",
        (e) => e.message,
      );
    await blocked();
    await a.query("commit");
    assert.equal(await lateWrite, "WAREHOUSE_DISABLED");
    await a.query("begin");
    await a.query("update public.stock set quantity=1 where product_id=$1", [
      p2,
    ]);
    const lateDisable = b
      .query("select public.disable_warehouse($1)", [second])
      .then(
        () => "unexpected success",
        (e) => e.message,
      );
    await blocked();
    await a.query("commit");
    assert.equal(await lateDisable, "WAREHOUSE_HAS_STOCK");
    const { rows } = await a.query(
      "select s.is_active,st.quantity from public.stores s join public.stock st on st.store_id=s.id where s.id=$1",
      [second],
    );
    assert.equal(rows[0].is_active, true);
    assert.equal(Number(rows[0].quantity), 1);
    console.log("Passed warehouse disable concurrency (both operation orders)");
  } finally {
    await Promise.all(
      clients.map(async (c) => {
        await c.query("rollback").catch(() => {});
        await c.end();
      }),
    );
  }
}
