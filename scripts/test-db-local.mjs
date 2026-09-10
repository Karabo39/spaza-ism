import { readFile, readdir } from "node:fs/promises";
import pg from "pg";

// Explicit local connection only: never consume the app's production credentials.
const url = process.env.BRD_TEST_DATABASE_URL;
if (!url) throw new Error("Set BRD_TEST_DATABASE_URL to an empty, disposable local PostgreSQL database.");
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("This bootstrap runner only accepts localhost databases.");
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query("select count(*)::int as n from information_schema.tables where table_schema in ('public', 'auth')");
  if (rows[0].n !== 0) throw new Error("Refusing to bootstrap a non-empty database. Create a fresh local database.");
  await client.query(await readFile("supabase/tests/local_bootstrap.sql", "utf8"));
  for (const name of (await readdir("supabase/migrations")).filter((n) => n.endsWith(".sql")).sort()) {
    if (name === "0024_reporting_history.sql") {
      await client.query("begin");
      await client.query(await readFile("supabase/tests/price_history_upgrade_before.sql", "utf8"));
      await client.query(await readFile(`supabase/migrations/${name}`, "utf8"));
      await client.query(await readFile("supabase/migrations/0026_preserve_price_history.sql", "utf8"));
      await client.query(await readFile("supabase/tests/price_history_upgrade_after.sql", "utf8"));
      await client.query("rollback");
      console.log("Passed existing price-history upgrade (rolled back)");
    }
    if (name === "0013_location_access.sql") {
      await client.query("begin");
      await client.query(await readFile("supabase/tests/location_upgrade_before.sql", "utf8"));
      await client.query(await readFile(`supabase/migrations/${name}`, "utf8"));
      await client.query(await readFile("supabase/tests/location_upgrade_after.sql", "utf8"));
      await client.query("rollback");
      console.log("Passed single-store and multi-store upgrade backfill (rolled back)");
    }
    await client.query(await readFile(`supabase/migrations/${name}`, "utf8"));
    console.log(`Applied ${name}`);
  }
  for (const file of ["rpc_integration.sql", "location_access.sql", "transfers.sql", "unpacking.sql", "card_payments.sql", "credit_overrides.sql", "invoices.sql", "returns.sql", "store_credit.sql", "report_email.sql", "report_history.sql", "notifications.sql", "imports.sql", "business_logos.sql", "bulk_count_override.sql", "stock_counts.sql", "module_access.sql", "cash_up.sql", "order_workflow.sql", "document_workflows.sql", "employee_invitations.sql", "batch_expiry_daily_totals.sql", "cash_shifts_barcode.sql", "invoice_refinements.sql", "store_currencies_documents.sql", "product_descriptions.sql"]) {
    try {
      await client.query(await readFile(`supabase/tests/${file}`, "utf8"));
      throw new Error(`${file}: missing rollback sentinel`);
    } catch (error) {
      if (error.message !== "TESTS_PASSED") throw error;
      console.log(`Passed ${file} (rolled back)`);
    }
  }
} finally { await client.end(); }




