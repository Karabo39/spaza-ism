import contract from "../../release-contract.json";

export function matchesRelease(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const status = value as { version?: unknown; capabilities?: Record<string, unknown> };
  return status.version === contract.version && !!status.capabilities &&
    contract.required.every((key) => status.capabilities?.[key] === true);
}

export async function databaseReady(fetcher: typeof fetch = fetch): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const response = await fetcher(new URL("/rest/v1/rpc/app_schema_status", url), {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: "{}", cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    return response.ok && matchesRelease(await response.json());
  } catch { return false; }
}
