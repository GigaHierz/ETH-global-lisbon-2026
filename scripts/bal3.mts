import { hbarBalance } from "@agentrouter/shared";
const ids = { agent: process.env.HEDERA_AGENT_ID!, exchange: process.env.HEDERA_EXCHANGE_ID!, provider: "0.0.9746271" };
const out: Record<string, number> = {};
for (const [k, id] of Object.entries(ids)) out[`${k} (${id})`] = await hbarBalance(id);
console.log(JSON.stringify(out, null, 1));
