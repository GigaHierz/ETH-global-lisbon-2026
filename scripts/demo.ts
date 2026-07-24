// `pnpm demo` — boots everything, narrates the story, runs the agent, waits for
// the verifier to catch the cheater. One command, works in MOCK_MODE with zero
// external dependencies (the stage-fallback path).

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = process.env.MOCK_MODE !== "false";
const procs: ChildProcess[] = [];

function banner(msg: string) {
  console.log(`\n${"═".repeat(70)}\n  ${msg}\n${"═".repeat(70)}`);
}

function boot(name: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const p = spawn("npx", ["tsx", "--env-file=.env", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.stdout!.on("data", (d) => process.stdout.write(d));
  p.stderr!.on("data", (d) => process.stderr.write(d));
  procs.push(p);
  return p;
}

async function waitFor(url: string, timeoutMs = 20000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function cleanup() {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

async function main() {
  banner(`AGENTROUTER DEMO — ${MOCK ? "MOCK MODE (no chain, in-memory ledger)" : "LIVE on Base Sepolia"}`);

  // 0. contracts check
  banner("0/5 · contracts check");
  const deployments = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments.json"), "utf8"));
  console.log(`  ERC-8004 IdentityRegistry:   ${deployments.baseSepolia.identityRegistry}`);
  console.log(`  ERC-8004 ReputationRegistry: ${deployments.baseSepolia.reputationRegistry}`);
  console.log(`  Staking:                     ${deployments.baseSepolia.staking ?? "(not deployed — mock slash only)"}`);

  // 1. providers
  banner("1/5 · booting 3 providers (provider3 is CHEATING: advertises 70b, serves 8b)");
  boot("provider1", ["provider/src/index.ts", "--profile", "provider1"]);
  boot("provider2", ["provider/src/index.ts", "--profile", "provider2"]);
  boot("provider3", ["provider/src/index.ts", "--profile", "provider3"], { CHEAT_MODE: "true" });
  await Promise.all([4021, 4022, 4023].map((p) => waitFor(`http://localhost:${p}/healthz`)));

  // 2. exchange
  banner("2/5 · booting exchange (routes to cheapest provider per model)");
  boot("exchange", ["exchange/src/index.ts"]);
  await waitFor("http://localhost:4100/healthz");
  await new Promise((r) => setTimeout(r, 1500)); // let discovery run

  // 3. verifier
  banner("3/5 · booting verifier (samples requests, replays vs witness, slashes)");
  boot("verifier", ["verifier/src/index.ts"], { VERIFY_INTERVAL_MS: "10000" });

  console.log("\n  📊 dashboard: run `pnpm dashboard` in another terminal → http://localhost:3000\n");

  // 4. agent buys inference
  banner("4/5 · agent buys 5 inference calls through the exchange");
  await new Promise((r) => setTimeout(r, 1000));
  const agent = boot("agent", ["agent/src/index.ts"]);
  await new Promise((res) => agent.on("exit", res));

  // 5. wait for the sting
  banner("5/5 · waiting for the verifier to audit the cheater…");
  console.log("  (provider3 undercuts on price, wins 70b traffic, and gets caught replaying)");
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const providers = await fetch("http://localhost:4100/providers").then((r) => r.json());
    const slashed = providers.find((p: { status: string }) => p.status === "slashed");
    if (slashed) {
      banner(`⚡ SLASHED: ${slashed.displayName} — stake cut, reputation zeroed, OUT of routing`);
      const again = await fetch("http://localhost:4100/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "What is Ethereum? One sentence." }] }),
      }).then((r) => r.json());
      console.log(`  next 70b request now routes to: ${again.agentrouter.provider} ($${again.agentrouter.pricePaidUsd}/req)`);
      banner("DEMO COMPLETE — services stay up for dashboard exploration. Ctrl-C to stop.");
      return; // keep processes alive
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("  verifier did not fire within 60s — check /tmp logs");
}

main().catch((e) => { console.error(e); cleanup(); });
