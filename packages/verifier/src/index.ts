// AgentRouter verifier: every INTERVAL, sample a recent routed request, replay the
// same prompt (temperature 0) against BOTH the original provider and a witness
// provider claiming the same model, compare answers, and slash on divergence.
//
// Only two intact, comparable replies can yield a divergent verdict. Timeouts,
// transport failures and unusably short answers are inconclusive and enforce nothing.
//
// Real mode pays both providers via x402 HBAR from the verifier Hedera account, then
// slashes by moving stake from escrow to treasury and publishing an HCS verdict
// (playbook steps 3-4). Mock mode uses mock payment headers and the exchange /slash
// endpoint only.

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  DEFAULT_EXCHANGE_URL,
  REQUEST_LOG_LIMIT,
  HEDERA_NETWORK,
  BOND_AMOUNT,
  hederaAccount,
  publishToTopic,
  recordVerdictOnZeroG,
  bondTokenId,
  freezeBond,
  multiSigWipeBond,
  log,
  type ProviderRow,
  type RequestLogEntry,
  type ChatCompletionResponse,
} from "@agentrouter/shared";
import { selectAuditCandidate } from "./audit-selection.js";
import { DEFAULT_SIMILARITY_THRESHOLD } from "./similarity.js";
import { classifyReplayOutcomes, shouldEnforceSlash, type ReplayOutcome } from "./verification.js";

const EXCHANGE = process.env.EXCHANGE_URL || DEFAULT_EXCHANGE_URL;
// Audits are sampled on a jittered schedule, not a metronome: a fixed period is
// a published timetable, and anything predictable is gameable — serve the real
// model for the second after each tick and a cheater is never caught. Each delay
// is drawn uniformly from ±VERIFY_JITTER around the base interval.
const INTERVAL_MS = parseInt(process.env.VERIFY_INTERVAL_MS || "15000", 10);
const JITTER = Math.min(0.9, Math.max(0, parseFloat(process.env.VERIFY_JITTER || "0.6")));
const nextDelayMs = () => Math.round(INTERVAL_MS * (1 - JITTER + Math.random() * 2 * JITTER));
const THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || String(DEFAULT_SIMILARITY_THRESHOLD));
const SLASH_HBAR = parseFloat(process.env.SLASH_HBAR || "25");
const REPLAY_TIMEOUT_MS = parseInt(process.env.REPLAY_TIMEOUT_MS || "20000", 10);
// How much of the exchange log to consider each tick. Defaults to the exchange's
// whole buffer, so no served request is out of audit reach just for being old.
const LOG_LIMIT = parseInt(process.env.VERIFY_LOG_LIMIT || String(REQUEST_LOG_LIMIT), 10);

const audited = new Set<string>(); // request ids already checked
const slashedWallets = new Set<string>(); // payout accounts this verifier has slashed
let auditInFlight = false; // one audit at a time: replays can outlast INTERVAL_MS

let payFetch: (url: string, init: RequestInit, price: number) => Promise<Response>;

async function initPayFetch() {
  if (MOCK_MODE) {
    payFetch = (url, init, price) =>
      fetch(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), [MOCK_PAYMENT_HEADER]: String(price) },
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

// Replays one prompt and maps every failure mode onto a ReplayOutcome instead
// of throwing, so the classifier — not the transport — decides the verdict.
//
// The replay carries no audit marker on purpose. It goes straight to the provider,
// bypassing the exchange, so it can never enter the request log and never become a
// future candidate — the marker would buy nothing here and would hand a provider a
// way to recognise an audit and serve the honest model only when it is being watched.
async function ask(
  providerUrl: string,
  model: string,
  prompt: string,
  price: number,
): Promise<ReplayOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPLAY_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await payFetch(
        `${providerUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
          }),
          signal: controller.signal,
        },
        price,
      );
    } catch (err) {
      if (controller.signal.aborted) return { kind: "timeout" };
      return { kind: "network_error", message: (err as Error).message };
    }

    if (!res.ok) return { kind: "http_error", status: res.status };

    let data: ChatCompletionResponse;
    try {
      data = (await res.json()) as ChatCompletionResponse;
    } catch {
      return { kind: "malformed_response" };
    }

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { kind: "malformed_response" };
    if (content.trim() === "") return { kind: "empty_response" };
    return { kind: "ok", text: content };
  } finally {
    clearTimeout(timer);
  }
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

// Verdict + HCS-14 reputation feedback onto the HCS verdicts topic.
async function publishVerdict(v: Record<string, unknown>) {
  if (MOCK_MODE) return;
  try {
    const tx = await publishToTopic("verdicts", hederaAccount("VERIFIER"), v);
    log("verifier", `verdict on HCS: https://hashscan.io/testnet/transaction/${tx}`);
  } catch (err) {
    log("verifier", `HCS verdict publish failed: ${(err as Error).message.slice(0, 100)}`);
  }
}

async function postBondEvent(body: Record<string, unknown>) {
  try {
    await fetch(`${EXCHANGE}/bond-event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log("verifier", `bond-event post failed: ${(err as Error).message.slice(0, 80)}`);
  }
}

// HTS ReputationBond enforcement — additive compliance layer on top of the proven
// native-HBAR slash. Destroy the fraudster's bond with a 2-of-2 multi-sig
// TokenWipe: the token's wipeKey is a KeyList [verifier, auditor], so the wipe
// carries two signatures (verifier + auditor) — reputation → 0 on-chain, no
// single party can do it alone. In real mode both signatures run here for the
// end-to-end demo; in production the auditor is an independent signer. All chain
// calls are no-ops in mock mode.
async function enforceBond(wallet: string, displayName: string) {
  const onChain = !MOCK_MODE && !!bondTokenId();
  // Only surface bond enforcement when it's real (on-chain) or in the mock demo.
  // In real mode without a configured bond token (`pnpm setup-hts` not run), the
  // feature is simply off — never post a wiped event for a bond that doesn't
  // exist on-chain.
  if (!MOCK_MODE && !onChain) return;

  let wipeTx: string | null = null;
  let freezeTx: string | null = null;
  if (onChain) {
    // Destroy, then contain — in that order. Hedera rejects TokenWipe against a
    // frozen balance (ACCOUNT_FROZEN_FOR_TOKEN), so freezing first would block the
    // very wipe it was meant to protect. Freezing afterwards still does the useful
    // work: the account cannot receive a replacement bond.
    wipeTx = await multiSigWipeBond(wallet, BOND_AMOUNT);
    if (wipeTx) log("verifier", `⚖️ 2-of-2 multi-sig bond wipe (${displayName}): https://hashscan.io/testnet/transaction/${wipeTx}`);
    freezeTx = await freezeBond(wallet);
    if (freezeTx) log("verifier", `🧊 bond frozen (${displayName}): https://hashscan.io/testnet/transaction/${freezeTx}`);
  }

  // Report what actually happened. Announcing "wiped, 0 tokens" regardless of the
  // outcome meant a failed wipe still showed the bond as destroyed — the dashboard
  // claiming an enforcement action the chain never performed, which is worse than
  // showing nothing at all.
  const bondStatus = wipeTx ? "wiped" : freezeTx ? "frozen" : "active";
  if (onChain && !wipeTx) {
    log("verifier", `🚨 bond NOT wiped for ${displayName} — reporting "${bondStatus}" rather than a wipe that did not happen`);
  }
  await postBondEvent({
    wallet,
    bondStatus,
    bondTokens: wipeTx ? 0 : BOND_AMOUNT,
    wipeTx,
  });
}

async function auditOnce() {
  if (auditInFlight) return;
  auditInFlight = true;
  try {
    const [logEntries, providers] = await Promise.all([
      fetch(`${EXCHANGE}/log?limit=${LOG_LIMIT}`).then((r) => r.json()) as Promise<RequestLogEntry[]>,
      fetch(`${EXCHANGE}/providers`).then((r) => r.json()) as Promise<ProviderRow[]>,
    ]);

    // A full page means the exchange had at least this much to give: anything older
    // is outside the audit window, so say so rather than let it look like coverage.
    if (logEntries.length >= LOG_LIMIT) {
      log("verifier", `log window saturated at ${LOG_LIMIT} entries — older requests are out of audit reach`);
    }

    const selection = selectAuditCandidate({
      requestLog: logEntries,
      providers,
      auditedRequestIds: audited,
      slashedWallets,
      random: Math.random, // sample a random eligible request, not the newest
    });
    if (selection.outcome === "skipped") {
      // A witness-less candidate is left un-audited on purpose: it becomes
      // auditable the moment a second provider for that model comes up.
      if (selection.reason === "no_witness") {
        log("verifier", `no witness available for ${selection.request.model} (unique model on the exchange — cross-backend outputs are not comparable) — skipping audit of ${selection.accused.displayName}`);
      }
      return;
    }

    const { request: candidate, accused: target, witness } = selection;
    audited.add(candidate.id); // claim it before the replays, so a slow audit is never re-run

    // TEE short-circuit: a 0G-broker response that carried a *verified* TEE
    // attestation is cryptographic proof of which model actually ran — the
    // optimistic Jaccard replay can't do better. Record a verified verdict
    // (Hedera HCS + 0G chain) and skip the replay/slash path entirely.
    if (candidate.servedBy === "0g" && candidate.teeAttested) {
      log("verifier", `🔐 TEE-attested 0G response from ${target.displayName} (${candidate.model}) — attestation is hard proof, no replay needed`);
      await fetch(`${EXCHANGE}/verify-report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: target.displayName, witness: "TEE attestation", similarity: 1, verdict: "ok" }),
      }).catch(() => {});
      await publishVerdict({
        type: "verdict", verdict: "ok", provider: target.displayName, account: target.wallet,
        agentId: target.agentId, model: target.model, method: "tee-attestation",
        attestationRef: candidate.attestationRef ?? null,
        hcs14: { feedback: { value: 100, tag1: "tee-verified", tag2: "agentrouter" } },
      });
      await recordVerdictOnZeroG({
        tradeId: candidate.id,
        provider: target.displayName,
        model: candidate.upstreamModel ?? candidate.model,
        servedBy: "0g",
        teeAttested: true,
        verdict: "ok",
      }).catch(() => {});
      return;
    }

    log("verifier", `🔍 AUDIT: replaying "${candidate.promptPreview.slice(0, 50)}…" — ${target.displayName} vs witness ${witness.displayName} (${target.model}, temp 0)`);

    const [targetOutcome, witnessOutcome] = await Promise.all([
      ask(target.url, candidate.model, candidate.promptPreview, target.price),
      ask(witness.url, candidate.model, candidate.promptPreview, witness.price),
    ]);
    const result = classifyReplayOutcomes(targetOutcome, witnessOutcome, THRESHOLD);

    // A flaky or silent provider is not a cheating one: nothing is reported,
    // published or slashed unless both replays came back intact and comparable.
    if (result.verdict === "inconclusive") {
      log("verifier", `🤷 inconclusive audit of ${target.displayName} (${result.reason}) — no enforcement`);
      return;
    }

    const a = targetOutcome.kind === "ok" ? targetOutcome.text : "";
    const b = witnessOutcome.kind === "ok" ? witnessOutcome.text : "";
    const sim = result.similarity ?? 0;
    const divergent = result.verdict === "divergent";

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
        hcs14: { feedback: { value: 100, tag1: "verified", tag2: "agentrouter" } },
      });
      return;
    }

    // Divergence is necessary but not sufficient: a provider already slashed keeps
    // its verdict on the dashboard and loses no second stake.
    if (!shouldEnforceSlash(result, target.wallet, slashedWallets)) {
      log("verifier", `${target.displayName} (${target.wallet}) already slashed — divergence recorded, no second slash`);
      return;
    }
    slashedWallets.add(target.wallet); // claimed before the awaits below settle

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
      hcs14: { feedback: { value: -100, tag1: "model-fraud", tag2: "agentrouter" } },
    });
    // Mirror the fraud verdict onto 0G Chain (no-op without ZEROG_CHAIN_KEY +
    // registry) so the on-chain verification trail lives on 0G, not just Hedera.
    await recordVerdictOnZeroG({
      tradeId: candidate.id,
      provider: target.displayName,
      model: target.model,
      servedBy: candidate.servedBy ?? "",
      teeAttested: false,
      verdict: "fraud",
    }).catch(() => {});
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

    // Additive HTS enforcement: destroy the bond with a 2-of-2 multi-sig wipe.
    await enforceBond(target.wallet, target.displayName);
  } catch (err) {
    log("verifier", `audit error: ${(err as Error).message.slice(0, 150)}`);
  } finally {
    auditInFlight = false;
  }
}

await initPayFetch();
log(
  "verifier",
  `watching ${EXCHANGE} — random audits every ${(INTERVAL_MS * (1 - JITTER) / 1000).toFixed(1)}-${(INTERVAL_MS * (1 + JITTER) / 1000).toFixed(1)}s, ` +
    `similarity threshold ${THRESHOLD}, slash ${SLASH_HBAR} ℏ (MOCK_MODE=${MOCK_MODE})`,
);
// Self-scheduling rather than setInterval: the next draw happens after the audit
// completes, so a slow replay can never stack overlapping runs.
function scheduleNextAudit() {
  const delay = nextDelayMs();
  setTimeout(() => {
    void auditOnce().finally(scheduleNextAudit);
  }, delay);
}
void auditOnce().finally(scheduleNextAudit);
