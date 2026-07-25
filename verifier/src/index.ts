// AgentRouter verifier: every INTERVAL, sample a recent routed request, replay the
// same prompt (temperature 0) against BOTH the original provider and a witness
// provider claiming the same model, compare answers, and slash on divergence.
//
// Real mode: pays both providers via x402 HBAR (verifier Hedera account),
// slash = escrow→treasury transfer + HCS verdict (playbook steps 3-4).
// Mock mode: mock payment headers, slash via exchange /slash only.

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  HEDERA_NETWORK,
  hederaAccount,
  publishToTopic,
  log,
  type ProviderRow,
  type ChatCompletionResponse,
} from "@agentrouter/shared";
import { similarity } from "./similarity.js";

const EXCHANGE = process.env.EXCHANGE_URL || "http://localhost:4100";
const INTERVAL_MS = parseInt(process.env.VERIFY_INTERVAL_MS || "15000", 10);
const THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || "0.35");
const SLASH_HBAR = parseFloat(process.env.SLASH_HBAR || "25");

const audited = new Set<string>(); // request ids already checked

let payFetch: (url: string, init: RequestInit, priceHbar: number) => Promise<Response>;

async function initPayFetch() {
  if (MOCK_MODE) {
    payFetch = (url, init, priceHbar) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), [MOCK_PAYMENT_HEADER]: String(priceHbar) },
      });
    return;
  }
  const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/client");
  const { createClientHederaSigner } = await import("@x402/hedera");
  const { PrivateKey } = await import("@hiero-ledger/sdk");
  const { id, key } = hederaAccount("VERIFIER");
  const signer = createClientHederaSigner(id, PrivateKey.fromStringECDSA(key), { network: HEDERA_NETWORK });
  const client = new x402Client();
  client.register("hedera:*", new ExactHederaScheme(signer));
  const wrapped = wrapFetchWithPayment(fetch, client);
  payFetch = (url, init) => wrapped(url, init as never);
}

async function ask(providerUrl: string, model: string, prompt: string, priceHbar: number): Promise<string> {
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
    priceHbar,
  );
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const data = (await res.json()) as ChatCompletionResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

// No-Solidity slash: move SLASH_HBAR from the verifier-held escrow account to
// the treasury (= operator). Returns the transfer tx id.
async function slashOnChain(providerWallet: string): Promise<string | null> {
  if (MOCK_MODE) return null;
  try {
    const { Client, AccountId, PrivateKey, Hbar, TransferTransaction } = await import("@hiero-ledger/sdk");
    const escrow = hederaAccount("ESCROW");
    const treasury = process.env.HEDERA_OPERATOR_ID;
    if (!treasury) throw new Error("HEDERA_OPERATOR_ID missing");
    const client = Client.forTestnet().setOperator(
      AccountId.fromString(escrow.id),
      PrivateKey.fromStringECDSA(escrow.key),
    );
    try {
      const tx = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(escrow.id), new Hbar(-SLASH_HBAR))
        .addHbarTransfer(AccountId.fromString(treasury), new Hbar(SLASH_HBAR))
        .execute(client);
      await tx.getReceipt(client);
      const id = tx.transactionId!.toString();
      log("verifier", `⛓ SLASH on-chain: ${SLASH_HBAR} ℏ escrow→treasury (stake of ${providerWallet})`);
      log("verifier", `⛓ https://hashscan.io/testnet/transaction/${id}`);
      return id;
    } finally {
      client.close();
    }
  } catch (err) {
    log("verifier", `on-chain slash failed: ${(err as Error).message.slice(0, 120)}`);
    return null;
  }
}

// Verdict + erc8004-compatible feedback onto the HCS verdicts topic.
async function publishVerdict(v: Record<string, unknown>) {
  if (MOCK_MODE) return;
  try {
    const tx = await publishToTopic("verdicts", hederaAccount("VERIFIER"), v);
    log("verifier", `verdict on HCS: https://hashscan.io/testnet/transaction/${tx}`);
  } catch (err) {
    log("verifier", `HCS verdict publish failed: ${(err as Error).message.slice(0, 100)}`);
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
      ask(target.url, target.model, candidate.promptPreview, target.priceHbar),
      ask(witness.url, witness.model, candidate.promptPreview, witness.priceHbar),
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
      await publishVerdict({
        type: "verdict", verdict: "ok", provider: target.displayName, account: target.wallet,
        agentId: target.agentId, witness: witness.displayName, model: target.model,
        similarity: Number(sim.toFixed(3)), threshold: THRESHOLD,
        erc8004_compat: { feedback: { value: 100, tag1: "verified", tag2: "agentrouter" } },
      });
      return;
    }

    // ---- busted ----
    log("verifier", `🚨🚨🚨 DIVERGENCE DETECTED 🚨🚨🚨`);
    log("verifier", `   ${target.displayName} claims ${target.model} but its answer diverges from witness ${witness.displayName} (similarity ${(sim * 100).toFixed(0)}% < ${THRESHOLD * 100}%)`);
    log("verifier", `   target : "${a.slice(0, 100)}"`);
    log("verifier", `   witness: "${b.slice(0, 100)}"`);
    log("verifier", `   SLASHING ${target.displayName} (${target.wallet})`);

    const tx = await slashOnChain(target.wallet);
    await publishVerdict({
      type: "verdict", verdict: "fraud", provider: target.displayName, account: target.wallet,
      agentId: target.agentId, witness: witness.displayName, model: target.model,
      similarity: Number(sim.toFixed(3)), threshold: THRESHOLD,
      slashHbar: SLASH_HBAR, slashTx: tx,
      erc8004_compat: { feedback: { value: -100, tag1: "model-fraud", tag2: "agentrouter" } },
    });
    await fetch(`${EXCHANGE}/slash`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: target.wallet,
        amountHbar: SLASH_HBAR,
        reason: `advertised ${target.model}, answers diverge from witness (${(sim * 100).toFixed(0)}% similarity)${tx ? ` · tx ${tx.slice(0, 10)}…` : ""}`,
      }),
    });
    log("verifier", `⚡ ${target.displayName} slashed and removed from routing`);
  } catch (err) {
    log("verifier", `audit error: ${(err as Error).message.slice(0, 150)}`);
  }
}

await initPayFetch();
log("verifier", `watching ${EXCHANGE} — audit every ${INTERVAL_MS / 1000}s, similarity threshold ${THRESHOLD}, slash ${SLASH_HBAR} ℏ (MOCK_MODE=${MOCK_MODE})`);
setInterval(auditOnce, INTERVAL_MS);
auditOnce();
