// Demo agent: an AI agent with a funded Hedera wallet buying inference through
// the exchange. Prints cost per call + remaining balance. --spam N for volume.
//
// The agent pays the exchange over x402: its own AGENT account signs the HBAR
// payment for the exchange's 402 ask (see payer.ts). The exchange routes to the
// cheapest live provider and settles that leg itself.

import { MOCK_MODE, hbarBalance, hederaAccount, log, DEFAULT_EXCHANGE_URL, DEFAULT_MODEL, DEFAULT_EXCHANGE_ASK_HBAR } from "@agentrouter/shared";
import { initAgentPayer, paidPost } from "./payer.js";

const EXCHANGE = process.env.EXCHANGE_URL || DEFAULT_EXCHANGE_URL;
const MODEL = process.env.AGENT_MODEL || DEFAULT_MODEL;
const ASK = parseFloat(process.env.EXCHANGE_ASK_HBAR || String(DEFAULT_EXCHANGE_ASK_HBAR)); // mock-mode payment amount

const QUESTIONS = [
  "What is the capital of Portugal? One sentence.",
  "What is x402? One sentence.",
  "What is Ethereum? One sentence.",
  "2 + 2 = ?",
  "Write a haiku about micropayments.",
];

const spamIdx = process.argv.indexOf("--spam");
const spamN = spamIdx >= 0 ? parseInt(process.argv[spamIdx + 1] || "10", 10) : 0;

let mockBalance = parseFloat(process.env.AGENT_MOCK_BALANCE_HBAR || "10");

async function realBalance(): Promise<string> {
  return (await hbarBalance(hederaAccount("AGENT").id)).toFixed(4);
}

async function callOnce(prompt: string, i: number, total: number) {
  const t0 = Date.now();
  const { res } = await paidPost(
    `${EXCHANGE}/v1/chat/completions`,
    { model: MODEL, messages: [{ role: "user", content: prompt }], temperature: 0 },
    ASK,
  );
  if (!res.ok) {
    log("agent", `[${i}/${total}] FAILED HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return;
  }
  const data = await res.json();
  const m = data.agentrouter;
  mockBalance -= m.pricePaidHbar;
  const balanceStr = MOCK_MODE ? `${mockBalance.toFixed(4)} ℏ (mock)` : `${await realBalance()} ℏ`;
  log("agent", `[${i}/${total}] "${prompt.slice(0, 40)}…"`);
  log("agent", `    → ${m.provider} | paid ${m.pricePaidHbar} ℏ | ${Date.now() - t0}ms | balance ${balanceStr}`);
  log("agent", `    ✦ ${data.choices[0].message.content.slice(0, 90)}`);
}

async function main() {
  log("agent", `AgentRouter demo agent → ${EXCHANGE} | model ${MODEL} | MOCK_MODE=${MOCK_MODE}`);
  await initAgentPayer();
  if (!MOCK_MODE) log("agent", `starting HBAR balance: ${await realBalance()} ℏ`);
  else log("agent", `starting mock balance: ${mockBalance.toFixed(4)} ℏ`);

  if (spamN > 0) {
    log("agent", `--spam ${spamN}: firing volume`);
    for (let i = 0; i < spamN; i++) {
      await callOnce(QUESTIONS[i % QUESTIONS.length], i + 1, spamN);
    }
  } else {
    for (let i = 0; i < QUESTIONS.length; i++) {
      await callOnce(QUESTIONS[i], i + 1, QUESTIONS.length);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  log("agent", `done. total spent: ${(MOCK_MODE ? parseFloat(process.env.AGENT_MOCK_BALANCE_HBAR || "10") - mockBalance : 0).toFixed(4)} ℏ${MOCK_MODE ? " (mock)" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
