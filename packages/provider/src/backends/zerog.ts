// 0G Compute backend: proxies completions to the 0G Compute Router — a single
// OpenAI-compatible endpoint over 0G's decentralized GPU marketplace (providers
// register on the 0G chain, per-request escrow settlement, TEE-signed results).
// Needs ZEROG_API_KEY from https://pc.0g.ai (funded with 0G testnet tokens).
// No key or router unreachable → canned fallback so the demo never blocks.

import {
  cannedCompletion,
  log,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from "@agentrouter/shared";

const ZEROG_ROUTER_URL =
  process.env.ZEROG_ROUTER_URL || "https://router-api.0g.ai/v1/chat/completions";

/* v8 ignore start -- network wiring; canned fallback is exercised via cannedCompletion's own tests */
export async function complete(
  req: ChatCompletionRequest,
  actualModel: string,
  advertisedModel: string,
  cannedCheat: boolean,
): Promise<ChatCompletionResponse> {
  const apiKey = process.env.ZEROG_API_KEY;
  if (!apiKey) {
    return cannedCompletion(advertisedModel, req.messages, cannedCheat);
  }
  try {
    const upstream = await fetch(ZEROG_ROUTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: actualModel,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.max_tokens ?? 512,
      }),
    });
    if (!upstream.ok) {
      throw new Error(`0G router ${upstream.status}: ${(await upstream.text()).slice(0, 200)}`);
    }
    const data = (await upstream.json()) as ChatCompletionResponse;
    data.model = advertisedModel;
    return data;
  } catch (e) {
    // Never block the marketplace on an upstream compute outage.
    log("provider", `0G backend unavailable (${(e as Error).message.slice(0, 120)}) — canned fallback`);
    return cannedCompletion(advertisedModel, req.messages, cannedCheat);
  }
}
/* v8 ignore stop */
