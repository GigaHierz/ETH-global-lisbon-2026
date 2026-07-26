"use client";

import { useEffect, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import Icon from "@/components/Icon";
import Card from "@/components/Card";
import NavStats from "@/components/NavStats";
import StatusPill from "@/components/StatusPill";
import Footer from "@/components/Footer";
import TerminalDots from "@/components/TerminalDots";
import { AGENT } from "@/lib/config";
import { useAssetSymbol } from "@/lib/settlement";
import { amount, money } from "@/lib/format";

// ---- types mirrored from the agent-server contract (dashboard is standalone) ----
interface Budget { cap: number; spent: number; remaining: number }
interface Finding { q: string; a: string }
interface Identity {
  agentId: string;
  account: string;
  hashscan: string;
  registeredTx?: string;
}
interface AgentState {
  running: boolean;
  goal: string | null;
  balance: number;
  budget: Budget;
  findings: Finding[];
  events: AgentEvent[];
}
// A durable, on-chain record of one inference call the agent bought (from GET /calls).
interface Call {
  ts: number;
  goal: string | null;
  question: string;
  answer: string;
  provider: string;
  cost: number;
  paymentRef: string;
  hashscan: string;
}

type AgentEvent =
  | { type: "goal"; goal: string }
  | { type: "plan"; questions: string[] }
  | {
      type: "bought";
      question: string;
      answer: string;
      cost: number;
      provider: string;
      paymentRef: string;
      remaining: number;
      hashscan: string;
    }
  | { type: "budget-exhausted"; remaining: number }
  | { type: "synthesis"; answer: string }
  | { type: "done"; spent: number; findings: number }
  | { type: "balance"; amount: number; asset?: string }
  | { type: "identity"; agentId: string; hashscan: string }
  | { type: "error"; message: string };

type Conn = "connecting" | "live" | "offline";

const DEFAULT_BUDGET: Budget = { cap: 0, spent: 0, remaining: 0 };

// One-click demo: two questions, each pinned to a specific model. Pinning `model`
// bypasses the agent's prompt router (agent-server /run) — the exchange then routes to
// the cheapest live provider for that model:
//   1. `0gm-1.0-35b-a3b`      → NimbusAI (0G backend) — the 0G showcase call.
//   2. `llama-3.3-70b-versatile` → SketchyGPU (cheater, undercuts Titan on the same model).
// The verifier reviews SketchyGPU against the honest 70b witness (Titan) and slashes it
// live within ~15s — the climax. Edit the goals here to change what's asked on stage.
const DEMO_QUESTIONS: Array<{ goal: string; model: string }> = [
  { goal: "Give a concise overview of how proof-of-stake secures a blockchain.", model: "0gm-1.0-35b-a3b" },
  { goal: "Prove step by step that the square root of 2 is irrational, explaining each step.", model: "llama-3.3-70b-versatile" },
];

function fmtTime(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function AgentDemoControlRoom() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [running, setRunning] = useState(false);
  const [goal, setGoal] = useState<string | null>(null);
  const [goalInput, setGoalInput] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [budget, setBudget] = useState<Budget>(DEFAULT_BUDGET);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One-click demo: fires DEMO_QUESTIONS (0G showcase, then the SketchyGPU slash) via
  // /run. Each /run is single-flight, so we wait for each to finish before the next;
  // demoStep drives the "1/2" progress label.
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  // "" = let the agent's router choose. Anything else pins the model, which is how
  // you demo a specific supply network (0G, say) instead of hoping the prompt
  // happens to land in that price tier.
  const [modelPick, setModelPick] = useState("");
  const [models, setModels] = useState<Array<{ model: string; price: number }>>([]);
  const [agenticId, setAgenticId] = useState<{
    enabled: boolean;
    contract: string | null;
    agenticId: {
      tokenId: string | null;
      explorer: string;
      memoryRoot: string;
      memoryTx: string;
      mintTx: string;
      callCount: number;
      inherited?: boolean;
    } | null;
  } | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  const sym = useAssetSymbol();

  // ---- durable "previous calls" (all runs), read from the agent's on-chain topic ----
  function refreshCalls() {
    fetch(`${AGENT}/calls?limit=50`)
      .then((r) => r.json())
      .then((d: { calls?: Call[] }) => setCalls(d.calls ?? []))
      .catch(() => {});
  }

  const esRef = useRef<EventSource | null>(null);
  const streamEnd = useRef<HTMLDivElement | null>(null);

  // ---- apply a single event to local state ----
  function applyEvent(ev: AgentEvent) {
    switch (ev.type) {
      case "goal":
        setGoal(ev.goal);
        setRunning(true);
        break;
      case "bought":
        setBudget((b) => ({ ...b, remaining: ev.remaining, spent: Math.max(0, b.cap - ev.remaining) }));
        break;
      case "budget-exhausted":
        setBudget((b) => ({ ...b, remaining: ev.remaining, spent: b.cap }));
        break;
      case "done":
        setRunning(false);
        setBudget((b) => ({ ...b, spent: ev.spent, remaining: Math.max(0, b.cap - ev.spent) }));
        // the run's calls are now durable — pull the refreshed history
        refreshCalls();
        break;
      case "balance":
        setBalance(ev.amount);
        break;
      case "identity":
        setIdentity((id) =>
          id
            ? { ...id, agentId: ev.agentId, hashscan: ev.hashscan }
            : { agentId: ev.agentId, account: (ev.agentId ?? "").split(":").pop() || "", hashscan: ev.hashscan }
        );
        break;
      default:
        break;
    }
  }

  // ---- hydrate identity + state, then open SSE ----
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    refreshCalls();

    fetch(`${AGENT}/identity`)
      .then((r) => r.json())
      .then((id: Identity) => { if (!cancelled) setIdentity(id); })
      .catch(() => {});

    // Pull the backend's authoritative run state. The SSE stream carries no
    // backlog, so events delivered while the connection was down are gone from
    // the live `events` array — and "ANSWERS BOUGHT" is derived from that array.
    // Re-hydrating on every (re)connect resyncs the count (and budget/balance) to
    // the server's `state.events`, which does retain every `bought`.
    function hydrateState() {
      fetch(`${AGENT}/state`)
        .then((r) => r.json())
        .then((s: AgentState) => {
          if (cancelled) return;
          setRunning(s.running);
          setGoal(s.goal);
          setBalance(s.balance);
          setBudget(s.budget ?? DEFAULT_BUDGET);
          setEvents(s.events ?? []);
        })
        .catch(() => {});
    }

    hydrateState();

    function connect() {
      if (cancelled) return;
      const es = new EventSource(`${AGENT}/events`);
      esRef.current = es;
      es.onopen = () => { if (!cancelled) { setConn("live"); hydrateState(); } };
      es.onmessage = (msg) => {
        let ev: AgentEvent;
        try { ev = JSON.parse(msg.data); } catch { return; }
        setEvents((list) => [...list, ev]);
        applyEvent(ev);
      };
      es.onerror = () => {
        setConn("offline");
        es.close();
        esRef.current = null;
        // graceful reconnect
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    }
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  // ---- autoscroll the reasoning stream ----
  useEffect(() => {
    streamEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [events.length]);

  useEffect(() => {
    fetch(`${AGENT}/models`)
      .then((r) => r.json())
      .then((m) => Array.isArray(m) && setModels(m))
      .catch(() => {});
  }, []);

  // Agentic ID: the agent tokenized on 0G Chain, memory in 0G Storage.
  function refreshAgenticId() {
    fetch(`${AGENT}/agentic-id`)
      .then((r) => r.json())
      .then(setAgenticId)
      .catch(() => {});
  }
  useEffect(() => {
    refreshAgenticId();
  }, []);
  async function mintAgenticId() {
    if (minting) return;
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch(`${AGENT}/agentic-id/mint`, { method: "POST" });
      if (!res.ok) {
        // Surface the real reason instead of silently no-op'ing — a 501 means 0G
        // isn't configured on the agent-server, a 500 carries the upstream error.
        const body = await res.json().catch(() => ({}));
        setMintError(body.error || `mint failed (${res.status})`);
        return;
      }
      refreshAgenticId();
    } catch {
      setMintError("agent-server unreachable");
    } finally {
      setMinting(false);
    }
  }

  async function submitGoal(e: React.FormEvent) {
    e.preventDefault();
    const g = goalInput.trim();
    if (!g || running || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${AGENT}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modelPick ? { goal: g, model: modelPick } : { goal: g }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body.error || `run rejected (${res.status})`);
        return;
      }
      // reset the local view for the new run; SSE will repopulate
      setEvents([]);
      setGoal(g);
      setRunning(true);
      setGoalInput("");
    } catch {
      setSubmitError("agent-server unreachable");
    } finally {
      setSubmitting(false);
    }
  }

  // Fire the DEMO_QUESTIONS (0G call, then the SketchyGPU slash) with no typing. /run is
  // single-flight (409 while a run is active), so between goals we poll /state until
  // the agent is idle before firing the next. A ~90s cap per goal keeps a wedged run
  // from hanging the whole sequence.
  async function runDemoSequence() {
    if (running || demoRunning || submitting) return;
    setSubmitError(null);
    setDemoRunning(true);
    try {
      for (let i = 0; i < DEMO_QUESTIONS.length; i++) {
        const { goal: g, model } = DEMO_QUESTIONS[i];
        setDemoStep(i + 1);
        // reset the local view for the new run; SSE repopulates it
        setEvents([]);
        setGoal(g);
        setRunning(true);
        const res = await fetch(`${AGENT}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal: g, model }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSubmitError(body.error || `demo run ${i + 1} rejected (${res.status})`);
          break;
        }
        // wait for this run to finish before firing the next (poll /state, ~90s cap)
        const deadline = Date.now() + 90_000;
        // give the server a beat to flip running→true before we start polling
        await new Promise((r) => setTimeout(r, 1500));
        while (Date.now() < deadline) {
          try {
            const s = (await (await fetch(`${AGENT}/state`)).json()) as AgentState;
            if (!s.running) break;
          } catch {
            /* transient — keep polling */
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    } catch {
      setSubmitError("agent-server unreachable");
    } finally {
      setDemoRunning(false);
      setDemoStep(0);
    }
  }

  const uaid = identity?.agentId || "uaid:aid:hedera:testnet:0.0.9746264";
  const idHashscan = identity?.hashscan;

  const pct = budget.cap > 0 ? Math.min(100, (budget.spent / budget.cap) * 100) : 0;
  const barClass = pct >= 90 ? "bg-hud-error" : pct >= 65 ? "bg-accent-orange" : "bg-accent-cyan";

  const plan = events.find((e): e is Extract<AgentEvent, { type: "plan" }> => e.type === "plan");
  const synthesis = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "synthesis" }> => e.type === "synthesis");
  const done = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "done" }> => e.type === "done");
  const bought = events.filter((e): e is Extract<AgentEvent, { type: "bought" }> => e.type === "bought");
  const errors = events.filter((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");

  // Cumulative across all runs: durable on-chain calls (GET /calls) plus the current
  // run's live boughts not yet flushed to /calls, deduped by paymentRef. refreshCalls()
  // on `done` reconciles the two, so a completed run's boughts never double-count.
  const callRefs = new Set(calls.map((c) => c.paymentRef));
  const liveBoughts = bought.filter((b) => !callRefs.has(b.paymentRef));
  const answersBought = calls.length + liveBoughts.length;
  const spentTotal = [...calls, ...liveBoughts].reduce((sum, x) => sum + x.cost, 0);

  const connDot = conn === "live" ? "bg-accent-cyan" : conn === "connecting" ? "bg-accent-orange" : "bg-hud-error";
  const connLabel = conn === "live" ? "Agent Live" : conn === "connecting" ? "Connecting…" : "Agent Offline";

  return (
    <div className="min-h-screen bg-surface-obsidian text-on-surface hud-grid-bg font-body selection:bg-accent-cyan/30">
      {/* ── Top Navigation ── */}
      <Navbar>
        <NavStats
          stats={[
            ["BALANCE", money(sym, balance, 2), "text-primary-fixed-dim"],
            ["SPENT", money(sym, spentTotal, 2), "text-accent-orange"],
            ["ANSWERS BOUGHT", String(answersBought), "text-primary-fixed-dim"],
          ]}
        />
        <StatusPill variant="nav" dotClassName={connDot} label={connLabel} />
      </Navbar>

      <main className="pt-24 pb-12 px-6 max-w-[1440px] mx-auto space-y-6">
        {/* offline notice */}
        {conn === "offline" && (
          <div role="alert" className="w-full py-3 px-6 border border-hud-error bg-hud-error-container/20 font-data text-xs text-hud-error flex items-center gap-3">
            <Icon name="warning" className="text-[18px]" />
            Can&apos;t reach the agent-server at {AGENT}. Retrying every 3s…
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ── Sidebar: identity + wallet ── */}
          <div className="lg:col-span-3 space-y-6">
            {/* Identity card */}
            <Card className="p-5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Icon name="fingerprint" className="text-8xl" />
              </div>
              <div className="relative z-10">
                <span className="font-data text-[11px] tracking-[0.1em] text-on-surface-variant mb-2 block">HCS-14 AGENT IDENTITY</span>
                {idHashscan ? (
                  <a href={idHashscan} target="_blank" rel="noreferrer"
                    className="font-data text-xs text-primary-fixed-dim hover:underline break-all">
                    {uaid} <Icon name="open_in_new" className="text-[12px]" />
                  </a>
                ) : (
                  <span className="font-data text-xs text-primary-fixed-dim break-all">{uaid}</span>
                )}
                <p className="mt-3 font-body text-[11px] text-on-surface-variant leading-tight">
                  Autonomous buyer: plans a goal into sub-questions, buys each answer from the exchange in USDC via x402, then synthesizes.
                </p>
              </div>
            </Card>

            {/* Wallet + budget card */}
            <Card className="p-5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Icon name="account_balance_wallet" className="text-8xl" />
              </div>
              <div className="relative z-10 space-y-4">
                <div>
                  <span className="font-data text-[10px] tracking-[0.1em] text-on-surface-variant block">AGENT WALLET</span>
                  <span className="font-data text-3xl font-bold text-on-surface">
                    <span className="text-primary-fixed-dim">{sym}</span>{amount(balance, 4)}
                  </span>
                </div>
                <div>
                  <div className="flex justify-between font-data text-[10px] tracking-[0.1em] text-on-surface-variant mb-1.5">
                    <span>BUDGET</span>
                    <span><span className="text-on-surface">{money(sym, budget.spent, 4)}</span> / {money(sym, budget.cap, 4)}</span>
                  </div>
                  <div className="h-2 w-full bg-surface-obsidian border border-outline-variant overflow-hidden">
                    <div className={`h-full transition-all duration-500 ${barClass}`} style={{ width: `${pct}%` }} aria-hidden />
                  </div>
                  <p className="mt-1.5 font-data text-[10px] text-on-surface-variant">
                    {money(sym, budget.remaining, 4)} REMAINING
                  </p>
                </div>
                {done && (
                  <div className="pt-3 border-t border-outline-variant flex justify-between font-data text-xs">
                    <span className="text-accent-cyan">✓ RUN COMPLETE</span>
                    <span className="text-on-surface-variant">{done.findings} findings</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Agentic ID card — the agent tokenized on 0G Chain, memory in 0G Storage */}
            {agenticId?.enabled && (
              <Card className="p-5 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Icon name="token" className="text-8xl" />
                </div>
                <div className="relative z-10 space-y-3">
                  <span className="font-data text-[11px] tracking-[0.1em] text-on-surface-variant block">
                    0G AGENTIC ID · TRADEABLE MEMORY
                  </span>
                  {agenticId.agenticId ? (
                    <>
                      <a
                        href={agenticId.contract ?? undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="font-data text-sm text-primary-fixed-dim hover:underline break-all"
                      >
                        Agent #{agenticId.agenticId.tokenId ?? "?"} <Icon name="open_in_new" className="text-[12px]" />
                      </a>
                      <div className="font-data text-[10px] text-on-surface-variant break-all">
                        <span className="text-on-surface-variant/70">memory @ 0G Storage:</span>{" "}
                        {agenticId.agenticId.memoryRoot.slice(0, 22)}…
                      </div>
                      <div className="font-data text-[10px] text-on-surface-variant">
                        {agenticId.agenticId.callCount} calls · encrypted (AES-256)
                      </div>
                      {agenticId.agenticId.inherited && (
                        <div className="font-data text-[10px] text-accent-cyan flex items-center gap-1">
                          <Icon name="download" className="text-[12px]" />
                          inherited memory · {agenticId.agenticId.callCount} calls loaded from 0G
                        </div>
                      )}
                      <button
                        onClick={mintAgenticId}
                        disabled={minting}
                        className="w-full border border-outline-variant text-on-surface-variant px-3 py-1.5 font-data text-[10px] tracking-[0.1em] uppercase disabled:opacity-40 hover:border-accent-cyan hover:text-on-surface transition-colors"
                      >
                        {minting ? "syncing…" : "↻ sync memory → 0G"}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="font-body text-[11px] text-on-surface-variant leading-tight">
                        Mint this agent as an ERC-7857-style Agentic ID on 0G Chain; its encrypted
                        memory lives in 0G Storage and travels with ownership.
                      </p>
                      <button
                        onClick={mintAgenticId}
                        disabled={minting}
                        className="w-full bg-accent-cyan text-on-primary px-3 py-2 font-data text-[10px] tracking-[0.1em] uppercase font-bold disabled:opacity-40 hover:glow-cyan transition-all active:scale-95"
                      >
                        {minting ? "minting…" : "mint agentic id"}
                      </button>
                    </>
                  )}
                  {mintError && (
                    <p className="font-data text-[10px] text-hud-error break-words">⚠ {mintError}</p>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* ── Main: goal + reasoning stream ── */}
          <div className="lg:col-span-9 space-y-6">
            {/* Goal command bar */}
            <Card className="overflow-hidden">
              <div className="bg-surface-container-low px-4 py-2 border-b border-outline-variant flex items-center justify-between">
                <span className="font-data text-[10px] tracking-[0.1em] text-on-surface-variant uppercase">Mission Control · Set a goal</span>
                <TerminalDots gapClassName="gap-1.5" dotClassName="w-2.5 h-2.5" />
              </div>
              <form onSubmit={submitGoal} className="flex gap-3 p-4 items-center">
                <span className="font-data text-accent-cyan shrink-0">&gt;_</span>
                <input
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  disabled={running || demoRunning}
                  placeholder={demoRunning ? "running demo…" : running ? "agent is working…" : "e.g. Compare the top 3 L1s by throughput and fees"}
                  className="flex-1 bg-surface-obsidian border border-outline-variant px-3 py-2 font-data text-sm text-on-surface outline-none focus:border-accent-cyan disabled:opacity-50 transition-colors"
                />
                <select
                  value={modelPick}
                  onChange={(e) => setModelPick(e.target.value)}
                  disabled={running || demoRunning}
                  title="Pin a model, or let the agent's router pick by prompt"
                  className="bg-surface-obsidian border border-outline-variant px-2 py-2 font-data text-[11px] text-on-surface-variant outline-none focus:border-accent-cyan disabled:opacity-50 transition-colors max-w-[190px]"
                >
                  <option value="">Auto (router)</option>
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.model.replace("-versatile", "").replace("-instant", "")} · {money(sym, m.price, 2)}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={running || demoRunning || submitting || !goalInput.trim()}
                  className="bg-accent-cyan text-on-primary px-6 py-2 font-data text-[11px] tracking-[0.1em] uppercase font-bold disabled:opacity-40 hover:glow-cyan transition-all active:scale-95"
                >
                  {running ? "Running…" : submitting ? "…" : "Run"}
                </button>
                <button
                  type="button"
                  onClick={runDemoSequence}
                  disabled={running || demoRunning || submitting}
                  title="Fire two questions — one at 0G (NimbusAI), then one that trips the SketchyGPU slash — no typing"
                  className="bg-accent-orange text-on-primary px-6 py-2 font-data text-[11px] tracking-[0.1em] uppercase font-bold whitespace-nowrap disabled:opacity-40 hover:brightness-110 transition-all active:scale-95"
                >
                  {demoRunning ? `Demo ${demoStep}/${DEMO_QUESTIONS.length}…` : "▶ Run Demo (0G + slash)"}
                </button>
              </form>
              {submitError && <p className="px-4 pb-3 font-data text-xs text-hud-error">⚠ {submitError}</p>}
              {goal && (
                <p className="px-4 pb-3 font-data text-xs text-on-surface-variant truncate">
                  ACTIVE GOAL: <span className="text-on-surface">{goal}</span>
                </p>
              )}
            </Card>

            {/* Live reasoning stream */}
            <Card className="relative hud-scanline overflow-hidden">
              <div className="p-4 border-b border-outline-variant flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${connDot} animate-pulse`} />
                  <span className="font-data text-[11px] tracking-[0.1em]">LIVE REASONING STREAM</span>
                </div>
                <span className="font-data text-[10px] text-on-surface-variant uppercase">
                  {bought.length} bought · {events.length} events
                </span>
              </div>

              <div className="p-5 space-y-5 max-h-[560px] overflow-y-auto">
                {events.length === 0 && (
                  <p className="font-data text-xs py-8 text-center text-on-surface-variant">
                    {running ? "waiting for the agent to plan…" : "no run yet — set a goal above and hit RUN."}
                  </p>
                )}

                {/* the plan */}
                {plan && (
                  <div className="row-in">
                    <div className="font-data text-[10px] tracking-[0.1em] uppercase text-on-surface-variant mb-2">
                      Plan · {plan.questions.length} sub-questions
                    </div>
                    <ol className="space-y-1.5">
                      {plan.questions.map((q, i) => (
                        <li key={i} className="flex gap-3 font-data text-xs">
                          <span className="shrink-0 text-accent-cyan font-bold">{String(i + 1).padStart(2, "0")}</span>
                          <span className="text-on-surface">{q}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* bought steps */}
                {bought.map((b, i) => (
                  <div key={i} className="row-in bg-surface-container-lowest border border-outline-variant/50 p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="font-data text-xs font-bold text-on-surface">» {b.question}</div>
                      <div className="shrink-0 font-data text-[11px] text-right">
                        <div>
                          <span className="text-accent-cyan">{b.provider}</span>
                          <span className="text-on-surface-variant"> · {money(sym, b.cost, 4)}</span>
                        </div>
                        {b.hashscan && (
                          <a href={b.hashscan} target="_blank" rel="noreferrer"
                            className="text-on-surface-variant hover:text-accent-cyan transition-colors">
                            payment tx <Icon name="open_in_new" className="text-[11px]" />
                          </a>
                        )}
                      </div>
                    </div>
                    <p className="font-body text-xs whitespace-pre-wrap text-on-surface-variant leading-relaxed">{b.answer}</p>
                  </div>
                ))}

                {/* budget exhausted */}
                {events.some((e) => e.type === "budget-exhausted") && (
                  <div className="row-in border border-accent-orange/50 bg-accent-orange/10 px-4 py-3 font-data text-xs text-accent-orange flex items-center gap-2">
                    <Icon name="warning" className="text-[16px]" />
                    BUDGET EXHAUSTED — the agent stopped buying and is synthesizing with what it has.
                  </div>
                )}

                {/* synthesis */}
                {synthesis && (
                  <div className="row-in border border-accent-cyan/50 bg-accent-cyan/5 p-4">
                    <div className="font-data text-[10px] tracking-[0.1em] uppercase text-accent-cyan mb-2">Synthesis</div>
                    <p className="font-body text-sm whitespace-pre-wrap text-on-surface leading-relaxed">{synthesis.answer}</p>
                  </div>
                )}

                {/* done summary */}
                {done && (
                  <div className="row-in flex flex-wrap gap-6 font-data text-xs border-t border-outline-variant pt-4 text-on-surface-variant">
                    <span className="text-accent-cyan">✓ DONE</span>
                    <span>TOTAL SPENT <span className="text-on-surface">{money(sym, done.spent, 4)}</span></span>
                    <span>FINDINGS <span className="text-on-surface">{done.findings}</span></span>
                  </div>
                )}

                {/* errors */}
                {errors.map((e, i) => (
                  <div key={i} className="font-data text-xs text-hud-error">⚠ {e.message}</div>
                ))}

                <div ref={streamEnd} />
              </div>
            </Card>

            {/* Previous calls — durable, on-chain history across all runs */}
            <Card className="overflow-hidden">
              <div className="p-4 border-b border-outline-variant flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Icon name="history" className="text-[16px] text-primary-fixed-dim" />
                  <span className="font-data text-[11px] tracking-[0.1em]">PREVIOUS CALLS</span>
                  <span className="font-data text-[10px] text-on-surface-variant">· durable on-chain history</span>
                </div>
                <span className="font-data text-[10px] text-on-surface-variant uppercase">
                  {calls.length} calls · all runs
                </span>
              </div>

              <div className="p-5 space-y-3 max-h-[420px] overflow-y-auto">
                {calls.length === 0 && (
                  <p className="font-data text-xs py-8 text-center text-on-surface-variant">
                    no calls yet — completed runs will appear here.
                  </p>
                )}

                {calls.map((c, i) => (
                  <div key={c.paymentRef || i} className="bg-surface-container-lowest border border-outline-variant/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-data text-xs font-bold text-on-surface truncate">» {c.question}</div>
                        <div className="font-data text-[10px] text-on-surface-variant truncate mt-0.5">
                          {c.goal ? `goal: ${c.goal} · ` : ""}{fmtTime(c.ts)}
                        </div>
                      </div>
                      <div className="shrink-0 font-data text-[11px] text-right">
                        <div>
                          <span className="text-accent-cyan">{c.provider}</span>
                          <span className="text-on-surface-variant"> · {money(sym, c.cost, 4)}</span>
                        </div>
                        {c.hashscan && (
                          <a href={c.hashscan} target="_blank" rel="noreferrer"
                            className="text-on-surface-variant hover:text-accent-cyan transition-colors">
                            payment tx <Icon name="open_in_new" className="text-[11px]" />
                          </a>
                        )}
                      </div>
                    </div>
                    {c.answer && (
                      <p className="mt-2 font-body text-xs text-on-surface-variant leading-relaxed line-clamp-2">{c.answer}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
