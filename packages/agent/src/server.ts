// The agent-server: a standalone HTTP + SSE service wrapping the buyer agent.
// On boot it registers its HCS-14 identity (via the Hedera Agent Kit) and readies
// its x402 payer. POST /run kicks off a budget-capped reasoning loop; GET /events
// streams every step (plan, paid buys with Hashscan links, synthesis) to the UI.

import express from "express";
import cors from "cors";
import { MOCK_MODE, settlementBalance, hederaAccount, hashscanTx, log, DEFAULT_EXCHANGE_URL, DEFAULT_MODEL, DEFAULT_EXCHANGE_ASK, ASSET_LABEL, money, publishToTopic, readTopicMessages } from "@agentrouter/shared";
import { Budget } from "./budget.js";
import { groqBrain } from "./brain.js";
import { makeBuy } from "./buy.js";
import { routeModel } from "./route-model.js";
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

// ---- boot ----
// The port is bound FIRST, before any chain work. Registering an HCS identity and
// reading an on-chain balance are network calls that can be slow, hang, or throw;
// doing them ahead of app.listen means a bad key or a stalled node stops the port
// from ever opening. The platform then reports "Application failed to respond"
// with nothing in the logs, because from the process's point of view it is still
// booting. Binding first turns that silence into a service that answers /healthz
// and tells you exactly what went wrong.
let identity: Identity = { agentId: "(registering…)", account: "", hashscan: "" };
let account = "";
let bootError: string | null = null;
let ready = false;

interface WireBudget {
  cap: number;
  spent: number;
  remaining: number;
}

// One durable record per inference call the agent bought. Written to the
// `agentCalls` HCS topic (real mode) and mirrored here in-memory so the
// dashboard's "Previous Calls" view has data before Mirror Node lag catches up
// and while running in mock mode.
interface Call {
  ts: number;
  goal: string | null;
  question: string;
  answer: string; // short preview — the on-chain message stays well under HCS size limits
  provider: string;
  cost: number;
  paymentRef: string;
  hashscan: string;
}
const ANSWER_PREVIEW = 240;
const CALLS_CAP = 200;
const calls: Call[] = [];

const state = {
  running: false,
  goal: null as string | null,
  balance: MOCK_MODE ? parseFloat(process.env.AGENT_MOCK_BALANCE || "10") : 0,
  budget: { cap: BUDGET, spent: 0, remaining: BUDGET } as WireBudget,
  findings: [] as { q: string; a: string }[],
  events: [] as unknown[],
};

// Default buy (fallback model); per-run buys are routed against the live market.
const buy = makeBuy(EXCHANGE, ASK, MODEL);

/** Route the goal to a model tier using the exchange's live provider market.
 *  An explicit `pick` skips the router entirely — the tier heuristic is prompt-shaped,
 *  which is fine for autonomy but useless when you need to demonstrate a specific
 *  supply network on demand. */
async function routedBuyFor(goal: string, pick?: string) {
  if (pick) {
    log("agent", `router: overridden — buying ${pick} explicitly`);
    return { buy: makeBuy(EXCHANGE, ASK, pick), route: { model: pick, tier: "medium" as const, reason: "model chosen explicitly" } };
  }
  try {
    const providers = (await (await fetch(`${EXCHANGE}/providers`)).json()) as Array<{
      model: string; price?: number; priceHbar?: number; status: string;
    }>;
    const market = providers.map((p) => ({ model: p.model, price: p.price ?? p.priceHbar ?? 0, status: p.status }));
    const route = routeModel(goal, market, MODEL);
    log("agent", `router: "${goal.slice(0, 48)}…" → ${route.tier} tier → ${route.model} (${route.reason})`);
    return { buy: makeBuy(EXCHANGE, ASK, route.model), route };
  } catch {
    return { buy, route: { model: MODEL, tier: "medium" as const, reason: "market unreachable — fallback" } };
  }
}

// Everything that touches the network, off the critical path to listening.
async function boot() {
  await initAgentPayer();
  identity = await registerIdentity({ displayName: "AgentRouter Demo Buyer", endpoint: ENDPOINT });
  account = MOCK_MODE ? "0.0.mock-agent" : hederaAccount("AGENT").id;
  if (!MOCK_MODE) state.balance = await settlementBalance(account);
  ready = true;
  log("agent", `ready | ${identity.agentId} | balance ${money(state.balance.toFixed(4))}`);
}

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
    recordCall(ev, wire.hashscan);
    return;
  }
  state.events.push(ev);
  broadcast(ev);
}

// Persist a bought call: buffer it in-memory (capped, survives across runs) and,
// in real mode, append it to the agent's own `agentCalls` HCS topic — a durable,
// per-agent, on-chain record of every paid inference call. Fire-and-forget: a
// publish failure never blocks or breaks the run.
function recordCall(ev: Extract<AgentEvent, { type: "bought" }>, hashscan: string) {
  const call: Call = {
    ts: Date.now(),
    goal: state.goal,
    question: ev.question,
    answer: ev.answer.slice(0, ANSWER_PREVIEW),
    provider: ev.provider,
    cost: ev.cost,
    paymentRef: ev.paymentRef,
    hashscan,
  };
  calls.push(call);
  if (calls.length > CALLS_CAP) calls.shift();

  if (!MOCK_MODE) {
    publishToTopic("agentCalls", hederaAccount("AGENT"), {
      type: "call",
      agentId: identity.agentId,
      goal: call.goal,
      question: call.question,
      answer: call.answer,
      provider: call.provider,
      cost: call.cost,
      paymentRef: call.paymentRef,
    }).catch((e) => log("agent", `HCS call publish failed: ${(e as Error).message.slice(0, 80)}`));
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// `ok` stays true while booting so a platform health check does not kill a service
// that is merely still starting; `ready` and `error` carry the real state.
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, ready, error: bootError, agentId: identity.agentId, account, mock: MOCK_MODE }),
);
app.get("/identity", (_req, res) => res.json(identity));

// The models the exchange can actually route to right now, cheapest first. The UI
// reads this to offer an explicit choice instead of hoping the router picks the one
// you want to show.
app.get("/models", async (_req, res) => {
  try {
    const providers = (await (await fetch(`${EXCHANGE}/providers`)).json()) as Array<{
      model: string; price?: number; status: string;
    }>;
    const cheapest = new Map<string, number>();
    for (const p of providers) {
      if (p.status !== "live" || typeof p.price !== "number" || !Number.isFinite(p.price)) continue;
      const seen = cheapest.get(p.model);
      if (seen === undefined || p.price < seen) cheapest.set(p.model, p.price);
    }
    res.json([...cheapest].sort((a, b) => a[1] - b[1]).map(([model, price]) => ({ model, price })));
  } catch {
    res.json([]);
  }
});
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

// Durable "previous calls": every inference call this agent bought, across all
// runs. Reads its own `agentCalls` HCS topic via the Mirror Node (survives
// restarts) and merges the in-memory buffer (instant reflection before Mirror
// lag; sole source in mock mode), deduped by payment ref, newest first.
app.get("/calls", async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50));
  let onChain: Call[] = [];
  if (!MOCK_MODE) {
    try {
      const msgs = await readTopicMessages("agentCalls", limit);
      onChain = msgs
        .map((m) => m.payload)
        .filter((p): p is Record<string, unknown> => !!p && p.type === "call" && p.agentId === identity.agentId)
        .map((p) => ({
          ts: Number(p.ts) || 0,
          goal: (p.goal as string) ?? null,
          question: String(p.question ?? ""),
          answer: String(p.answer ?? ""),
          provider: String(p.provider ?? ""),
          cost: Number(p.cost) || 0,
          paymentRef: String(p.paymentRef ?? ""),
          hashscan: hashscanTx(String(p.paymentRef ?? "")),
        }));
    } catch (e) {
      log("agent", `/calls Mirror Node read failed: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  const byRef = new Map<string, Call>();
  for (const c of [...onChain, ...calls]) byRef.set(c.paymentRef, c);
  const merged = [...byRef.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
  res.json({ calls: merged });
});

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

app.post("/run", async (req, res) => {
  if (!ready) return res.status(503).json({ error: bootError ?? "agent is still starting up" });
  if (state.running) return res.status(409).json({ error: "a run is already in progress" });
  const body = req.body as { goal?: string; model?: string };
  const goal = body?.goal?.trim();
  if (!goal) return res.status(400).json({ error: "goal required" });
  const pick = body?.model?.trim() || undefined;

  state.running = true;
  state.goal = goal;
  state.events = [];
  state.findings = [];
  const budget = new Budget(BUDGET);
  state.budget = { cap: BUDGET, spent: 0, remaining: BUDGET };
  res.json({ ok: true });

  const routed = await routedBuyFor(goal, pick);
  broadcast({ type: "route", model: routed.route.model, tier: routed.route.tier, reason: routed.route.reason });
  state.events.push({ type: "route", model: routed.route.model, tier: routed.route.tier, reason: routed.route.reason });

  runGoal(goal, {
    brain: groqBrain,
    buy: routed.buy,
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
  log("agent", `agent-server on :${PORT} | budget ${money(BUDGET)} | MOCK_MODE=${MOCK_MODE}`);
  log("agent", `buying ${MODEL} via ${EXCHANGE} @ ${money(ASK)}/req`);
  boot().catch((e: Error) => {
    bootError = e.message;
    log("agent", `BOOT FAILED: ${e.message} — serving /healthz so the cause is visible`);
  });
});
