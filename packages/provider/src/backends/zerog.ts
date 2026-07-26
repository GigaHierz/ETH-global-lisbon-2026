// 0G Compute backend — two paths to 0G's decentralized GPU marketplace:
//
//  1. Router (default): a single OpenAI-compatible endpoint (router-api.0g.ai/v1)
//     behind ZEROG_API_KEY from https://pc.0g.ai. Set ZEROG_TRUST_MODE=verified to
//     request TEE-verified inference; any attestation the router returns is captured
//     as provenance. Simple, no wallet needed.
//
//  2. Broker (opt-in, ZEROG_BROKER_ENABLED=1 + a funded ZEROG_CHAIN_KEY): the
//     @0gfoundation/0g-compute-ts-sdk broker discovers a TEE (TeeML) provider,
//     acknowledges its signer, sends a signed request, and *cryptographically
//     verifies* the response (processResponse). This turns provenance from an
//     echoed model id into a verified TEE attestation.
//
// No key / broker unreachable / any error → canned fallback so the demo never blocks.

import {
  cannedCompletion,
  log,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatMessage,
} from "@agentrouter/shared";

const ZEROG_ROUTER_URL =
  process.env.ZEROG_ROUTER_URL || "https://router-api.0g.ai/v1/chat/completions";
const ZEROG_CHAIN_RPC = process.env.ZEROG_CHAIN_RPC || "https://evmrpc-testnet.0g.ai";

// 0G's flagship model (0gm-1.0-35b-a3b) runs with "thinking" on by default, so the
// request needs generous headroom — with a small cap the whole budget is spent on the
// reasoning trace and `content` comes back empty. Overridable via ZEROG_MAX_TOKENS.
const ZEROG_MAX_TOKENS = Number(process.env.ZEROG_MAX_TOKENS) || 4096;

function canned(advertisedModel: string, req: ChatCompletionRequest, cheat: boolean): ChatCompletionResponse {
  return { ...cannedCompletion(advertisedModel, req.messages, cheat), servedBy: "canned" as const };
}

/** Thinking-enabled 0G models can return the final answer in `reasoning_content` with
 * `content` left empty. Promote that text into `content` so a 200 carrying a real answer
 * isn't rejected downstream (the agent's parser requires non-empty content). Returns
 * true when the response now has usable content, false when it should be treated as a
 * soft failure (→ canned fallback, honoring this backend's "never blocks" contract). */
export function salvageThinkingAnswer(data: ChatCompletionResponse): boolean {
  const msg = data.choices?.[0]?.message as (ChatMessage & { reasoning_content?: string }) | undefined;
  if (!msg) return false;
  if ((!msg.content || msg.content.length === 0) &&
      typeof msg.reasoning_content === "string" && msg.reasoning_content.length > 0) {
    msg.content = msg.reasoning_content;
  }
  return typeof msg.content === "string" && msg.content.length > 0;
}

/* v8 ignore start -- network/broker wiring; canned fallback is covered by cannedCompletion's tests */

// Broker path: real 0G Compute with TEE attestation verification via the SDK.
// Dynamically imported so the default Router path needs neither ethers nor the SDK.
async function completeViaBroker(
  req: ChatCompletionRequest,
  advertisedModel: string,
): Promise<ChatCompletionResponse | null> {
  const key = process.env.ZEROG_CHAIN_KEY?.trim();
  if (!key) return null;
  // @ts-ignore optional dependency — only present when the broker path is used
  const { ethers } = await import("ethers");
  // @ts-ignore optional dependency — only present when the broker path is used
  const { createZGComputeNetworkBroker } = await import("@0gfoundation/0g-compute-ts-sdk");

  const provider = new ethers.JsonRpcProvider(ZEROG_CHAIN_RPC);
  const wallet = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);
  const broker = await createZGComputeNetworkBroker(wallet);

  // Ensure a funded ledger (first run creates it; later runs already have one).
  try {
    await broker.ledger.addLedger(0.05);
  } catch {
    /* ledger already exists */
  }

  // Prefer a TEE-verifiable (TeeML) provider.
  const services = await broker.inference.listService();
  const svc = services.find((s: { verifiability: string }) => s.verifiability === "TeeML") ?? services[0];
  if (!svc) throw new Error("no 0G inference providers available");
  const providerAddress = svc.provider as string;

  const status = await broker.inference.checkProviderSignerStatus(providerAddress);
  if (!status.isAcknowledged) await broker.inference.acknowledgeProviderSigner(providerAddress);

  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
  const headers = await broker.inference.getRequestHeaders(providerAddress);

  // fetch (not the OpenAI SDK) so we can read the ZG-Res-Key attestation header.
  const upstream = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers as unknown as Record<string, string>) },
    body: JSON.stringify({
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.max_tokens ?? ZEROG_MAX_TOKENS,
    }),
  });
  if (!upstream.ok) throw new Error(`0G broker ${upstream.status}: ${(await upstream.text()).slice(0, 160)}`);
  const chatID = upstream.headers.get("ZG-Res-Key") ?? undefined;
  const data = (await upstream.json()) as ChatCompletionResponse;

  // Thinking-model answers can land in reasoning_content — salvage before we verify or
  // return. Empty even after that → soft-fail so complete() falls back (router/canned).
  if (!salvageThinkingAnswer(data)) throw new Error("0G broker returned empty completion");

  // Cryptographically verify the TEE-signed response.
  const answer = data.choices?.[0]?.message?.content ?? "";
  const valid = await broker.inference.processResponse(providerAddress, chatID, answer).catch(() => null);

  data.upstreamModel = data.model; // broker-reported model — verbatim provenance
  data.model = advertisedModel;
  data.servedBy = "0g";
  data.teeAttested = valid === true && svc.verifiability === "TeeML";
  if (chatID) data.attestationRef = chatID;
  log("provider", `0G broker served ${providerAddress.slice(0, 10)}… (${svc.verifiability}, verified=${data.teeAttested})`);
  return data;
}

// Router path: OpenAI-compatible HTTP with optional TEE trust-mode.
async function completeViaRouter(
  req: ChatCompletionRequest,
  actualModel: string,
  advertisedModel: string,
): Promise<ChatCompletionResponse | null> {
  const apiKey = process.env.ZEROG_API_KEY;
  if (!apiKey) return null;
  const trustMode = process.env.ZEROG_TRUST_MODE?.trim(); // "verified" | "private" | unset
  const upstream = await fetch(ZEROG_ROUTER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(trustMode ? { "X-0G-Provider-Trust-Mode": trustMode } : {}),
    },
    body: JSON.stringify({
      model: actualModel,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.max_tokens ?? ZEROG_MAX_TOKENS,
    }),
  });
  if (!upstream.ok) {
    throw new Error(`0G router ${upstream.status}: ${(await upstream.text()).slice(0, 200)}`);
  }
  // Capture any attestation the router surfaces (verified trust mode).
  const attestation = upstream.headers.get("ZG-Res-Key") ?? upstream.headers.get("X-0G-Attestation") ?? undefined;
  const data = (await upstream.json()) as ChatCompletionResponse;
  // Thinking-model answers can arrive in reasoning_content with content empty. Salvage
  // it; if the model still returned nothing usable, return null so complete() falls back
  // to the canned answer rather than forwarding an empty completion the agent rejects.
  if (!salvageThinkingAnswer(data)) {
    log("provider", "0G router returned empty completion — canned fallback");
    return null;
  }
  data.upstreamModel = data.model; // router-reported model — verbatim provenance
  data.model = advertisedModel;
  data.servedBy = "0g";
  if (attestation) {
    data.teeAttested = trustMode === "verified";
    data.attestationRef = attestation;
  }
  return data;
}

export async function complete(
  req: ChatCompletionRequest,
  actualModel: string,
  advertisedModel: string,
  cannedCheat: boolean,
): Promise<ChatCompletionResponse> {
  // Broker path first when explicitly enabled (real TEE verification).
  if (process.env.ZEROG_BROKER_ENABLED === "1") {
    try {
      const viaBroker = await completeViaBroker(req, advertisedModel);
      if (viaBroker) return viaBroker;
    } catch (e) {
      log("provider", `0G broker unavailable (${(e as Error).message.slice(0, 120)}) — trying router`);
    }
  }
  try {
    const viaRouter = await completeViaRouter(req, actualModel, advertisedModel);
    if (viaRouter) return viaRouter;
  } catch (e) {
    log("provider", `0G router unavailable (${(e as Error).message.slice(0, 120)}) — canned fallback`);
  }
  return canned(advertisedModel, req, cannedCheat);
}
/* v8 ignore stop */
