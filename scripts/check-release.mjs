import { readFile } from "node:fs/promises";

if (process.argv.includes("--if-hosted") && process.env.VERCEL !== "1") {
  console.log("Local build: hosted database check is available with npm run release:check.");
  process.exit(0);
}
const contract = JSON.parse(await readFile(new URL("../release-contract.json", import.meta.url), "utf8"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
try {
  if (!url || !key) throw new Error("missing configuration");
  const response = await fetch(new URL("/rest/v1/rpc/app_schema_status", url), {
    method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("database unavailable");
  const status = await response.json();
  if (status.version !== contract.version || !contract.required.every(key => status.capabilities?.[key] === true)) {
    throw new Error("incompatible database");
  }
  console.log("Release check passed: required database features are available.");
} catch {
  console.error("Release blocked: verify database connectivity and apply the tested migrations before deploying this app. No database changes were made by this check.");
  process.exitCode = 1;
}
