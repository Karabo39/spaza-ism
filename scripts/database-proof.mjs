import { createHash } from "node:crypto";
export function localDatabase(value) {
  if (!value || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname)) throw new Error("A disposable localhost database is required.");
  return new URL(value);
}
const identifier = (name) => '"' + name.replaceAll('"', '""') + '"';
export async function databaseProof(client) {
  const { rows: tables } = await client.query("select table_schema,table_name from information_schema.tables where table_type='BASE TABLE' and table_schema in ('public','auth','app','app_private','storage') order by table_schema,table_name");
  const rows = {};
  for (const t of tables) {
    const name = identifier(t.table_schema) + "." + identifier(t.table_name);
    rows[t.table_schema + "." + t.table_name] = (await client.query("select count(*)::text as count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),'')) as checksum from " + name + " t")).rows[0];
  }
  const { rows: policies } = await client.query("select schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check from pg_policies where schemaname in ('public','auth','app','app_private','storage') order by schemaname,tablename,policyname");
  const { rows: functions } = await client.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,md5(pg_get_functiondef(p.oid)) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app','app_private','auth') and p.prokind='f' order by n.nspname,p.proname,args");
  const { rows: rls } = await client.query("select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','auth','app','app_private','storage') order by n.nspname,c.relname");
  const stock = await client.query("select count(*)::int n from public.stock s full join (select store_id,product_id,sum(quantity_delta) quantity from public.stock_movements group by store_id,product_id) m using(store_id,product_id) where coalesce(s.quantity,0)<>coalesce(m.quantity,0)");
  const credit = await client.query("select count(*)::int n from public.credit_accounts a left join (select credit_account_id,sum(amount) balance from public.credit_transactions group by credit_account_id) t on t.credit_account_id=a.id where a.balance<>coalesce(t.balance,0)");
  if (stock.rows[0].n || credit.rows[0].n) throw new Error("Restored ledgers do not reconcile.");
  return { tables: rows, schemaChecksum: createHash("sha256").update(JSON.stringify({ policies, functions, rls })).digest("hex"), stockDifferences: 0, creditDifferences: 0 };
}
