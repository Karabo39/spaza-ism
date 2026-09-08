import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { localDatabase } from "./database-proof.mjs";

// Run after the SQL suites. Commit their synthetic document fixture so the
// archive contains quotations, attached PO bytes, invoices and partial refunds.
const source = localDatabase(process.env.BRD_TEST_DATABASE_URL);
const client = new pg.Client({ connectionString: source.href });
await client.connect();
const target = new URL(source);
target.pathname = "/restore_" + randomUUID().replaceAll("-", "");
try {
  for (const suite of ["document_workflows", "employee_invitations"]) {
    const fixture = await readFile(`supabase/tests/${suite}.sql`, "utf8");
    if (!fixture.includes("raise exception 'TESTS_PASSED';"))
      throw new Error("Document fixture sentinel missing");
    await client.query(
      fixture.replace("raise exception 'TESTS_PASSED';", "null;"),
    );
  }
  await client.query('create database "' + target.pathname.slice(1) + '"');
} finally {
  await client.end();
}
process.env.BACKUP_SOURCE_DATABASE_URL = source.href;
process.env.RESTORE_TEST_DATABASE_URL = target.href;
await import("./verify-backup-restore.mjs");
