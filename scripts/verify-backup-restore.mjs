import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { databaseProof, localDatabase } from "./database-proof.mjs";

// A drill creates its own local archive. It never connects to production or
// uses application credentials, never drops a database and never overwrites one.
const sourceUrl = localDatabase(process.env.BACKUP_SOURCE_DATABASE_URL);
const targetUrl = localDatabase(process.env.RESTORE_TEST_DATABASE_URL);
if (sourceUrl.href === targetUrl.href) throw new Error("Source and restore target must be different.");
const source = new pg.Client({ connectionString: sourceUrl.href });
const target = new pg.Client({ connectionString: targetUrl.href });
await Promise.all([source.connect(), target.connect()]);
const folder = path.resolve("node_modules/.cache/restore-drill-" + Date.now());
const archive = path.join(folder, "database.dump");
const bin = process.env.POSTGRES_BIN;
async function command(name, args, url) {
  const executable = bin ? path.join(bin, name + (process.platform === "win32" ? ".exe" : "")) : name;
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)) };
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(name + " exited with code " + code + ". Verify local PostgreSQL versions, roles and extensions.")));
  });
}
try {
  const { rows } = await target.query("select count(*)::int n from information_schema.tables where table_schema not in ('pg_catalog','information_schema')");
  if (rows[0].n !== 0) throw new Error("Restore target is not empty. Create a new disposable local database.");
  await mkdir(folder, { recursive: true });
  await source.query("begin isolation level repeatable read read only");
  const snapshot = (await source.query("select pg_export_snapshot() snapshot")).rows[0].snapshot;
  const before = await databaseProof(source);
  await command("pg_dump", ["--format=custom", "--no-owner", "--snapshot=" + snapshot, "--file=" + archive], sourceUrl);
  await source.query("commit");
  await command("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--dbname=" + targetUrl.pathname.slice(1), archive], targetUrl);
  const after = await databaseProof(target);
  assert.deepEqual(after, before, "Restored records, RLS policies and function definitions must match the source.");
  const report = { verifiedAt: new Date().toISOString(), scope: "Local restore drill using synthetic test data; not a production recovery verification.", ...after };
  await writeFile(path.join(folder, "proof.json"), JSON.stringify(report, null, 2));
  assert.ok((await readFile(archive)).byteLength > 0);
  console.log("Restore drill passed: " + Object.keys(after.tables).length + " tables, matching records and access rules; stock and credit reconcile.");
  console.log("Proof saved in " + path.relative(process.cwd(), path.join(folder, "proof.json")));
} finally {
  await source.query("rollback").catch(() => {});
  await Promise.all([source.end(), target.end()]);
}
