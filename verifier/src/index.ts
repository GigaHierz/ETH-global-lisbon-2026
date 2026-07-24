// AgentRouter verifier: every INTERVAL, sample a recent routed request, replay the
// same prompt (temperature 0) against BOTH the original provider and a witness
// provider claiming the same model, compare answers, and slash on divergence.
//
// Real mode: pays both providers via x402 (VERIFIER_PK), slashes on Staking.sol,
// files negative feedback in the ERC-8004 Reputation Registry.
// Mock mode: mock payment headers, slash via exchange /slash only.

import fs from "node:fs";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { parseEther } from "viem";
import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  REPUTATION_REGISTRY,
  reputationRegistryAbi,
  stakingAbi,
  publicClient,
  walletClient,
  log,
  requireEnv,
  type ProviderRow,
  type ChatCompletionResponse,
} from "@agentrouter/shared";
import { similarity } from "./similarity.js";

const EXCHANGE = process.env.EXCHANGE_URL || "http://localhost:4100";
const INTERVAL_MS = parseInt(process.env.VERIFY_INTERVAL_MS || "15000", 10);
const THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || "0.35");
const SLASH_USD = parseFloat(process.env.SLASH_USD || "25");

const audited = new Set<string>(); // request ids already checked

let payFetch: (url: string, init: RequestInit, priceUsd: number) => Promise<Response>;

async function initPayFetch() {
  if (MOCK_MODE) {
    payFetch = (url, init, priceUsd) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), [MOCK_PAYMENT_HEADER]: String(priceUsd) },
      });
    return;
  }
  const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm/exact/client");
  const account = privateKeyToAccount(requireEnv("VERIFIER_PK") as `0x${string}`);
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(account));
  const wrapped = wrapFetchWithPayment(fetch, client);
  payFetch = (url, init) => wrapped(url, init as never);
}

async function ask(providerUrl: string, model: string, prompt: string, priceUsd: number): Promise<string> {
  const res = await payFetch(
    `${providerUrl}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    },
    priceUsd,
  );
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const data = (await res.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

async function slashOnChain(providerWallet: string): Promise<string | null> {
  try {
    const deployments = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "deployments.json"), "utf8"),
    );
    const staking = deployments.baseSepolia?.staking;
    if (!staking) {
      log("verifier", "no Staking deployment in deployments.json — skipping on-chain slash");
      return null;
    }
    const account = privateKeyToAccount(requireEnv("VERIFIER_PK") as `0x${string}`);
    const wc = walletClient(account);
    const hash = await wc.writeContract({
      address: staking,
      abi: stakingAbi,
      functionName: "slash",
      args: [providerWallet as `0x${string}`, parseEther("0.01")],
    });
    await publicClient().waitForTransactionReceipt({ hash });
    log("verifier", `on-chain slash tx: ${hash}`);
    return hash;
  } catch (err) {
    log("verifier", `on-chain slash failed: ${(err as Error).message.slice(0, 120)}`);
    return null;
  }
}

async function fileFeedback(agentId: string | null, providerUrl: string, negative: boolean) {
  if (MOCK_MODE || !agentId || agentId.startsWith("mock-")) return;
  try {
    const account = privateKeyToAccount(requireEnv("VERIFIER_PK") as `0x${string}`);
    const wc = walletClient(account);
    const hash = await wc.writeContract({
      address: REPUTATION_REGISTRY,
      abi: reputationRegistryAbi,
      functionName: "giveFeedback",
      args: [
        BigInt(agentId),
        negative ? -100n : 100n, // value
        0, // decimals
        negative ? "model-fraud" : "verified",
        "agentrouter",
        providerUrl,
        "",
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ],
    });
    log("verifier", `ERC-8004 feedback filed (${negative ? "NEGATIVE" : "positive"}): ${hash}`);
  } catch (err) {
    log("verifier", `feedback failed: ${(err as Error).message.slice(0, 120)}`);
  }
}

async function auditOnce() {
  try {
    const [logEntries, providers] = await Promise.all([
      fetch(`${EXCHANGE}/log?limit=50`).then((r) => r.json()),
      fetch(`${EXCHANGE}/providers`).then((r) => r.json()) as Promise<ProviderRow[]>,
    ]);

    // Newest un-audited successful request whose provider is still live
    const candidate = [...logEntries].reverse().find(
      (e: { id: string; status: string; provider: string }) =>
        e.status === "ok" &&
        !audited.has(e.id) &&
        providers.some((p) => p.displayName === e.provider && p.status === "live"),
    );
    if (!candidate) return;
    audited.add(candidate.id);

    const target = providers.find((p) => p.displayName === candidate.provider)!;
    const witness = providers.find(
      (p) => p.status === "live" && p.model === target.model && p.url !== target.url,
    );
    if (!witness) {
      log("verifier", `no witness for ${target.model} — skipping audit of ${target.displayName}`);
      return;
    }

    log("verifier", `🔍 AUDIT: replaying "${candidate.promptPreview.slice(0, 50)}…" — ${target.displayName} vs witness ${witness.displayName} (${target.model}, temp 0)`);

    const [a, b] = await Promise.all([
      ask(target.url, target.model, candidate.promptPreview, target.priceUsd),
      ask(witness.url, witness.model, candidate.promptPreview, witness.priceUsd),
    ]);
    const sim = similarity(a, b);
    const divergent = sim < THRESHOLD;

    await fetch(`${EXCHANGE}/verify-report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: target.displayName,
        witness: witness.displayName,
        similarity: sim,
        verdict: divergent ? "divergent" : "ok",
      }),
    });

    if (!divergent) {
      log("verifier", `✅ ${target.displayName} verified (similarity ${(sim * 100).toFixed(0)}% ≥ ${THRESHOLD * 100}%)`);
      return;
    }

    // ---- busted ----
    log("verifier", `🚨🚨🚨 DIVERGENCE DETECTED 🚨🚨🚨`);
    log("verifier", `   ${target.displayName} claims ${target.model} but its answer diverges from witness ${witness.displayName} (similarity ${(sim * 100).toFixed(0)}% < ${THRESHOLD * 100}%)`);
    log("verifier", `   target : "${a.slice(0, 100)}"`);
    log("verifier", `   witness: "${b.slice(0, 100)}"`);
    log("verifier", `   SLASHING ${target.displayName} (${target.wallet})`);

    const tx = await slashOnChain(target.wallet);
    await fileFeedback(target.agentId, target.url, true);
    await fetch(`${EXCHANGE}/slash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: target.wallet,
        amountUsd: SLASH_USD,
        reason: `advertised ${target.model}, answers diverge from witness (${(sim * 100).toFixed(0)}% similarity)${tx ? ` · tx ${tx.slice(0, 10)}…` : ""}`,
      }),
    });
    log("verifier", `⚡ ${target.displayName} slashed and removed from routing`);
  } catch (err) {
    log("verifier", `audit error: ${(err as Error).message.slice(0, 150)}`);
  }
}

await initPayFetch();
log("verifier", `watching ${EXCHANGE} — audit every ${INTERVAL_MS / 1000}s, similarity threshold ${THRESHOLD}, slash $${SLASH_USD} (MOCK_MODE=${MOCK_MODE})`);
setInterval(auditOnce, INTERVAL_MS);
auditOnce();
