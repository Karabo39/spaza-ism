// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import contract from "../../release-contract.json";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); });
async function runGate(response: unknown, status = 200) {
  const server = createServer((_req, res) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(response)); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/check-release.mjs"], { windowsHide: true, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + port, NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-secret-must-not-appear" } });
    let output = "";
    child.stdout.on("data", (data) => output += data);
    child.stderr.on("data", (data) => output += data);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}
describe("hosted release gate", () => {
  it("blocks an incompatible release and never prints the configured key", async () => {
    const r = await runGate({ version: 1, capabilities: {} });
    expect(r.code).toBe(1); expect(r.output).toContain("Release blocked"); expect(r.output).not.toContain("test-secret");
  });
  it("blocks database failures and permits the full release contract", async () => {
    expect((await runGate({}, 503)).code).toBe(1);
    expect((await runGate({ version: contract.version, capabilities: Object.fromEntries(contract.required.map((key) => [key, true])) })).code).toBe(0);
  });
});
