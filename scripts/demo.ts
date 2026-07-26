// `pnpm demo` — boots everything, narrates the story, runs the agent, waits for
// the verifier to catch the cheater. One command, works in MOCK_MODE with zero
// external dependencies (the stage-fallback path).

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_PAYMENT_HEADER, DEFAULT_EXCHANGE_ASK, DEFAULT_EXCHANGE_URL, DEFAULT_MODEL, ZEROG_MODEL, money } from "@agentrouter/shared";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK = process.env.MOCK_MODE !== "false";
const EXCHANGE_ASK = process.env.EXCHANGE_ASK || String(DEFAULT_EXCHANGE_ASK);
const EXCHANGE_URL = process.env.EXCHANGE_URL || DEFAULT_EXCHANGE_URL;
const procs: ChildProcess[] = [];

function banner(msg: string) {
  console.log(`\n${"═".repeat(70)}\n  ${msg}\n${"═".repeat(70)}`);
}

function boot(name: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const p = spawn("npx", ["tsx", "--env-file=.env", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: true, // Windows: resolve npx.cmd shim (no behavior change to the demo)
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
  banner(`AGENTROUTER DEMO — ${MOCK ? "MOCK MODE (no chain, in-memory ledger)" : "LIVE on Hedera Testnet"}`);

  // 0. on-chain config check
  banner("0/5 · Hedera config check");
  const deployments = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments.json"), "utf8"));
  const h = deployments.hederaTestnet;
  console.log(`  Network:            ${h.network}  (${h.explorer})`);
  console.log(`  HCS registry topic: ${h.topics.registry}`);
  console.log(`  HCS trades topic:   ${h.topics.trades}`);
  console.log(`  HCS verdicts topic: ${h.topics.verdicts}`);

  // 1. providers
  banner("1/5 · booting 4 providers (provider3 CHEATS: advertises 70b, serves 8b · provider4 resells 0G Compute)");
  boot("provider1", ["packages/provider/src/index.ts", "--profile", "provider1"]);
  boot("provider2", ["packages/provider/src/index.ts", "--profile", "provider2"]);
  boot("provider3", ["packages/provider/src/index.ts", "--profile", "provider3"], { CHEAT_MODE: "true" });
  boot("provider4", ["packages/provider/src/index.ts", "--profile", "provider4"]); // 0G Compute-backed, unique model
  await Promise.all([4021, 4022, 4023, 4024].map((p) => waitFor(`http://localhost:${p}/healthz`)));

  // 2. exchange
  banner("2/5 · booting exchange (routes to cheapest provider per model)");
  boot("exchange", ["packages/exchange/src/index.ts"], {
    // seed discovery with all four local providers (mock mode has no HCS registry)
    PROVIDER_URLS: [4021, 4022, 4023, 4024].map((p) => `http://localhost:${p}`).join(","),
  });
  await waitFor(`${EXCHANGE_URL}/healthz`);
  await new Promise((r) => setTimeout(r, 1500)); // let discovery run

  // 3. verifier
  banner("3/5 · booting verifier (samples requests, replays vs witness, slashes)");
  boot("verifier", ["packages/verifier/src/index.ts"], { VERIFY_INTERVAL_MS: "10000" });

  console.log("\n  📊 dashboard: run `pnpm dashboard` in another terminal → http://localhost:3000\n");

  // 4. agent buys inference
  banner("4/5 · agent buys 5 inference calls through the exchange");
  await new Promise((r) => setTimeout(r, 1000));
  const agent = boot("agent", ["packages/agent/src/index.ts"]);
  await new Promise((res) => agent.on("exit", res));

  // 5. wait for the sting
  banner("5/5 · waiting for the verifier to audit the cheater…");
  console.log("  (provider3 undercuts on price, wins 70b traffic, and gets caught replaying)");
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const providers = await fetch(`${EXCHANGE_URL}/providers`).then((r) => r.json());
    const slashed = providers.find((p: { status: string }) => p.status === "slashed");
    if (slashed) {
      banner(`⚡ SLASHED: ${slashed.displayName} — HBAR stake cut, HTS bond wiped via 2-of-2 multi-sig, OUT of routing`);
      // Same paywall as every other buyer call: in mock mode the exchange wants
      // the mock payment header, in real mode the caller must settle over x402.
      const res = await fetch(`${EXCHANGE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(MOCK ? { [MOCK_PAYMENT_HEADER]: EXCHANGE_ASK } : {}),
        },
        body: JSON.stringify({ model: DEFAULT_MODEL, messages: [{ role: "user", content: "What is Ethereum? One sentence." }] }),
      });
      const raw = await res.text();
      let routed: { provider: string; total: number } | undefined;
      try {
        routed = (JSON.parse(raw) as { agentrouter?: { provider: string; total: number } }).agentrouter;
      } catch { /* non-JSON error body — reported below */ }
      if (res.ok && routed) {
        console.log(`  next 70b request now routes to: ${routed.provider} (${money(routed.total)}/req incl. fee)`);
      } else {
        console.log(`  reroute check failed: exchange answered HTTP ${res.status} — ${raw.slice(0, 120)}`);
      }

      // 6. bonus beat: buy one completion sourced from 0G Compute's decentralized
      // GPU network (provider4's unique model — doesn't touch the 70b arc).
      banner(`6/6 · one trade sourced from 0G Compute (${ZEROG_MODEL} via NimbusAI)`);
      const zg = await fetch(`${EXCHANGE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(MOCK ? { [MOCK_PAYMENT_HEADER]: "0.10" } : {}),
        },
        body: JSON.stringify({ model: ZEROG_MODEL, messages: [{ role: "user", content: "What is 0G? One sentence." }] }),
      });
      const zgRaw = await zg.text();
      try {
        const zgJson = JSON.parse(zgRaw) as { agentrouter?: { provider: string; total?: number; paymentRef?: string }; servedBy?: string; choices?: Array<{ message?: { content?: string } }> };
        if (zg.ok && zgJson.agentrouter) {
          const source = zgJson.servedBy === "0g" ? "0G Compute Router" : `${zgJson.servedBy ?? "unknown"} fallback (ZEROG_API_KEY pending)`;
          console.log(`  0G trade: ${zgJson.agentrouter.provider} | ${money(zgJson.agentrouter.total ?? "?")} | source: ${source} | pay=${(zgJson.agentrouter.paymentRef ?? "").slice(0, 24)}`);
          console.log(`  ✦ ${(zgJson.choices?.[0]?.message?.content ?? "").slice(0, 90)}`);
        } else {
          console.log(`  0G trade skipped: HTTP ${zg.status} — ${zgRaw.slice(0, 100)}`);
        }
      } catch {
        console.log(`  0G trade skipped: HTTP ${zg.status} — ${zgRaw.slice(0, 100)}`);
      }
      banner("DEMO COMPLETE — services stay up for dashboard exploration. Ctrl-C to stop.");
      return; // keep processes alive
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("  verifier did not fire within 60s — check /tmp logs");
}

main().catch((e) => { console.error(e); cleanup(); });
