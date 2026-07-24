// Canned responses used when GROQ_API_KEY is missing (stage-fallback mode).
// Keyed by a hash of the prompt so repeated identical prompts (verifier replay,
// temperature 0) get identical answers — and the "cheat" variant differs, so the
// verifier demo still works without a Groq key.

import type { ChatCompletionResponse, ChatMessage } from "./types.js";

const GOOD: Record<string, string> = {
  default:
    "The answer involves several considerations, but in short: yes — with the usual engineering caveats.",
  capital:
    "The capital of Portugal is Lisbon, located on the Atlantic coast at the mouth of the Tagus River.",
  ethereum:
    "Ethereum is a decentralized blockchain platform featuring smart contracts; ETH is its native asset used for gas.",
  x402:
    "x402 is an open payment protocol by Coinbase that uses the HTTP 402 status code so clients can pay for API requests with stablecoins.",
  math: "2 + 2 = 4.",
  haiku: "Silent chains agree —\nvalue flows through open pipes,\nagents pay their way.",
};

// Deliberately different phrasing/answers: what a lazy small model might say.
const CHEAT: Record<string, string> = {
  default: "Yes.",
  capital: "Lisbon is the capital city of Portugal.",
  ethereum: "Ethereum is a cryptocurrency like Bitcoin.",
  x402: "x402 is an HTTP error code for payments.",
  math: "The answer is 4.",
  haiku: "Payments are cool\nblockchain blockchain blockchain yes\nthis is a haiku",
};

function classify(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("capital")) return "capital";
  if (p.includes("ethereum")) return "ethereum";
  if (p.includes("x402")) return "x402";
  if (p.includes("2 + 2") || p.includes("2+2")) return "math";
  if (p.includes("haiku")) return "haiku";
  return "default";
}

export function cannedCompletion(
  model: string,
  messages: ChatMessage[],
  cheat: boolean,
): ChatCompletionResponse {
  const prompt = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const bank = cheat ? CHEAT : GOOD;
  const content = bank[classify(prompt)];
  return {
    id: `chatcmpl-canned-${Math.random().toString(36).slice(2, 10)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 32, completion_tokens: 24, total_tokens: 56 },
  };
}
