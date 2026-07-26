// The agent-server: a standalone HTTP + SSE service wrapping the buyer agent.
// On boot it registers its HCS-14 identity (via the Hedera Agent Kit) and readies
// its x402 payer. POST /run kicks off a budget-capped reasoning loop; GET /events
// streams every step (plan, paid buys with Hashscan links, synthesis) to the UI.

import express from "express";
import cors from "cors";
import { MOCK_MODE, settlementBalance, hederaAccount, hashscanTx, log, DEFAULT_EXCHANGE_URL, DEFAULT_MODEL, DEFAULT_EXCHANGE_ASK, ASSET_LABEL, money } from "@agentrouter/shared";
import { Budget } from "./budget.js";
import { groqBrain } from "./brain.js";
import { makeBuy } from "./buy.js";
import { initAgentPayer } from "./payer.js";
import { registerIdentity, type Identity } from "./identity.js";
import { runGoal, type AgentEvent } from "./loop.js";

// Hosts (Railway/Render/Fly) inject PORT; fall back to AGENT_PORT locally.
const PORT = parseInt(process.env.PORT || process.env.AGENT_PORT || "4200", 10);
const EXCHANGE = process.env.EXCHANGE_URL || DEFAULT_EXCHANGE_URL;
const MODEL = process.env.AGENT_MODEL || DEFAULT_MODEL;
const ASK = parseFloat(process.env.EXCHANGE_ASK || String(DEFAULT_EXCHANGE_ASK));
const BUDGET = parseFloat(process.env.AGENT_BUDGET || "2");
// Public URL advertised in the HCS-14 registration (set to the host's URL in prod).
const ENDPOINT = process.env.AGENT_PUBLIC_URL || `http://localhost:${PORT}`;

// ---- boot: identity + payer + starting balance ----
await initAgentPayer();
const identity: Identity = await registerIdentity({ displayName: "AgentRouter Demo Buyer", endpoint: ENDPOINT });
const account = MOCK_MODE ? "0.0.mock-agent" : hederaAccount("AGENT").id;

interface WireBudget {
  cap: number;
  spent: number;
  remaining: number;
}
const state = {
  running: false,
  goal: null as string | null,
  balance: MOCK_MODE ? parseFloat(process.env.AGENT_MOCK_BALANCE || "10") : await settlementBalance(account),
  budget: { cap: BUDGET, spent: 0, remaining: BUDGET } as WireBudget,
  findings: [] as { q: string; a: string }[],
  events: [] as unknown[],
};

const buy = makeBuy(EXCHANGE, ASK, MODEL);

// ---- SSE fanout ----
const clients = new Set<(chunk: string) => void>();
function broadcast(event: unknown) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const w of clients) {
    try {
      w(payload);
    } catch {
      clients.delete(w);
    }
  }
}

// Bridge loop events onto the wire: enrich `bought` with a Hashscan link, decrement
// the live balance, and mirror the reasoning flow into state.events for /state hydration.
function emit(ev: AgentEvent) {
  if (ev.type === "bought") {
    const wire = { ...ev, hashscan: hashscanTx(ev.paymentRef) };
    state.balance -= ev.cost;
    state.events.push(wire);
    broadcast(wire);
    broadcast({ type: "balance", amount: state.balance, asset: ASSET_LABEL });
    return;
  }
  state.events.push(ev);
  broadcast(ev);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, agentId: identity.agentId, account }));
app.get("/identity", (_req, res) => res.json(identity));
app.get("/state", (_req, res) =>
  res.json({
    running: state.running,
    goal: state.goal,
    balance: state.balance,
    budget: state.budget,
    findings: state.findings,
    events: state.events,
  }),
);

app.get("/events", (req, res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "identity", agentId: identity.agentId, hashscan: identity.hashscan })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "balance", amount: state.balance, asset: ASSET_LABEL })}\n\n`);
  const write = (chunk: string) => res.write(chunk);
  clients.add(write);
  req.on("close", () => clients.delete(write));
});

app.post("/run", (req, res) => {
  if (state.running) return res.status(409).json({ error: "a run is already in progress" });
  const goal = (req.body as { goal?: string })?.goal?.trim();
  if (!goal) return res.status(400).json({ error: "goal required" });

  state.running = true;
  state.goal = goal;
  state.events = [];
  state.findings = [];
  const budget = new Budget(BUDGET);
  state.budget = { cap: BUDGET, spent: 0, remaining: BUDGET };
  res.json({ ok: true });

  runGoal(goal, {
    brain: groqBrain,
    buy,
    budget,
    ask: ASK,
    emit: (ev) => {
      emit(ev);
      state.budget = { cap: BUDGET, spent: budget.spent, remaining: budget.remaining };
    },
  })
    .then((r) => {
      state.findings = r.findings;
    })
    .catch((e: Error) => {
      log("agent", `run failed: ${e.message}`);
      broadcast({ type: "error", message: e.message });
      state.events.push({ type: "error", message: e.message });
    })
    .finally(() => {
      state.running = false;
    });
});

app.listen(PORT, () => {
  log("agent", `agent-server on :${PORT} | ${identity.agentId} | budget ${money(BUDGET)} | MOCK_MODE=${MOCK_MODE}`);
  log("agent", `buying ${MODEL} via ${EXCHANGE} @ ${money(ASK)}/req | balance ${money(state.balance.toFixed(4))}`);
});
