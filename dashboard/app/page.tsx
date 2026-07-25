"use client";

import { useEffect, useRef, useState } from "react";

// Backend URL priority: ?api=https://… query param → build-time env → localhost.
// The query param survives tunnel churn without a rebuild.
const AGENT =
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("api")) ||
  process.env.NEXT_PUBLIC_AGENT_URL ||
  "http://localhost:4200";

// ---- types mirrored from the agent-server contract (dashboard is standalone) ----
interface Budget { capHbar: number; spentHbar: number; remainingHbar: number }
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
  balanceHbar: number;
  budget: Budget;
  findings: Finding[];
  events: AgentEvent[];
}

type AgentEvent =
  | { type: "goal"; goal: string }
  | { type: "plan"; questions: string[] }
  | {
      type: "bought";
      question: string;
      answer: string;
      costHbar: number;
      provider: string;
      paymentRef: string;
      remainingHbar: number;
      hashscan: string;
    }
  | { type: "budget-exhausted"; remainingHbar: number }
  | { type: "synthesis"; answer: string }
  | { type: "done"; spentHbar: number; findings: number }
  | { type: "balance"; hbar: number }
  | { type: "identity"; agentId: string; hashscan: string }
  | { type: "error"; message: string };

type Conn = "connecting" | "live" | "offline";

const DEFAULT_BUDGET: Budget = { capHbar: 0, spentHbar: 0, remainingHbar: 0 };

// stable-ish key for streamed events (index-based, list is append-only)
function evKey(ev: AgentEvent, i: number) {
  return `${i}-${ev.type}`;
}

export default function AgentPage() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [running, setRunning] = useState(false);
  const [goal, setGoal] = useState<string | null>(null);
  const [goalInput, setGoalInput] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [budget, setBudget] = useState<Budget>(DEFAULT_BUDGET);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        setBudget((b) => ({ ...b, remainingHbar: ev.remainingHbar, spentHbar: Math.max(0, b.capHbar - ev.remainingHbar) }));
        break;
      case "budget-exhausted":
        setBudget((b) => ({ ...b, remainingHbar: ev.remainingHbar, spentHbar: b.capHbar }));
        break;
      case "done":
        setRunning(false);
        setBudget((b) => ({ ...b, spentHbar: ev.spentHbar, remainingHbar: Math.max(0, b.capHbar - ev.spentHbar) }));
        break;
      case "balance":
        setBalance(ev.hbar);
        break;
      case "identity":
        setIdentity((id) =>
          id
            ? { ...id, agentId: ev.agentId, hashscan: ev.hashscan }
            : { agentId: ev.agentId, account: ev.agentId.split(":").pop() || "", hashscan: ev.hashscan }
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

    fetch(`${AGENT}/identity`)
      .then((r) => r.json())
      .then((id: Identity) => { if (!cancelled) setIdentity(id); })
      .catch(() => {});

    fetch(`${AGENT}/state`)
      .then((r) => r.json())
      .then((s: AgentState) => {
        if (cancelled) return;
        setRunning(s.running);
        setGoal(s.goal);
        setBalance(s.balanceHbar);
        setBudget(s.budget ?? DEFAULT_BUDGET);
        setEvents(s.events ?? []);
      })
      .catch(() => {});

    function connect() {
      if (cancelled) return;
      const es = new EventSource(`${AGENT}/events`);
      esRef.current = es;
      es.onopen = () => { if (!cancelled) setConn("live"); };
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
        body: JSON.stringify({ goal: g }),
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

  const uaid = identity?.agentId || "uaid:aid:hedera:testnet:0.0.9746264";
  const idHashscan = identity?.hashscan;

  const pct = budget.capHbar > 0 ? Math.min(100, (budget.spentHbar / budget.capHbar) * 100) : 0;
  const barColor = pct >= 90 ? "var(--danger)" : pct >= 65 ? "#f59e0b" : "var(--accent)";

  const plan = events.find((e): e is Extract<AgentEvent, { type: "plan" }> => e.type === "plan");
  const synthesis = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "synthesis" }> => e.type === "synthesis");
  const done = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "done" }> => e.type === "done");
  const bought = events.filter((e): e is Extract<AgentEvent, { type: "bought" }> => e.type === "bought");
  const errors = events.filter((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");

  const connColor = conn === "live" ? "var(--accent)" : conn === "connecting" ? "#f59e0b" : "var(--danger)";
  const connLabel = conn === "live" ? "agent live" : conn === "connecting" ? "connecting…" : "agent-server offline";

  return (
    <main className="min-h-screen p-4 max-w-[1100px] mx-auto">
      {/* header */}
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-3 mb-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--accent)" }}>AGENTROUTER</h1>
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>buyer agent · x402 · HCS-14 · hedera testnet</span>
        </div>
        <div className="flex items-center gap-4 text-xs" style={{ color: "var(--ink-muted)" }}>
          <span className="flex items-center gap-1.5">
            <span className="uppercase tracking-widest text-[10px]">UAID</span>
            {idHashscan ? (
              <a href={idHashscan} target="_blank" rel="noreferrer" className="underline decoration-dotted" style={{ color: "var(--ink)" }}>
                {uaid} ↗
              </a>
            ) : (
              <span style={{ color: "var(--ink)" }}>{uaid}</span>
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: connColor }} aria-hidden />
            {connLabel}
          </span>
        </div>
      </header>

      {/* offline notice */}
      {conn === "offline" && (
        <div role="alert" className="mb-4 rounded border px-4 py-2 text-xs" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "rgb(239 68 68 / 0.08)" }}>
          Can’t reach the agent-server at {AGENT}. Retrying every 3s… make sure it’s running.
        </div>
      )}

      {/* controls + meters */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {/* goal input */}
        <section className="lg:col-span-2 rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--ink-muted)" }}>Goal</h2>
          <form onSubmit={submitGoal} className="flex gap-2">
            <input
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              disabled={running}
              placeholder={running ? "agent is working…" : "e.g. Compare the top 3 L1s by throughput and fees"}
              className="flex-1 rounded border px-3 py-1.5 text-xs outline-none disabled:opacity-50"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink)" }}
            />
            <button
              type="submit"
              disabled={running || submitting || !goalInput.trim()}
              className="rounded px-4 py-1.5 text-xs font-bold disabled:opacity-40"
              style={{ background: "var(--accent)", color: "var(--surface)" }}
            >
              {running ? "running…" : submitting ? "…" : "Run"}
            </button>
          </form>
          {submitError && <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>{submitError}</p>}
          {goal && (
            <p className="mt-2 text-xs truncate" style={{ color: "var(--ink-muted)" }}>
              active goal: <span style={{ color: "var(--ink)" }}>{goal}</span>
            </p>
          )}
        </section>

        {/* balance + budget */}
        <section className="rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--ink-muted)" }}>Wallet</h2>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-xs" style={{ color: "var(--ink-muted)" }}>balance</span>
            <span className="text-lg font-bold" style={{ color: "var(--ink)" }}>
              {balance == null ? "—" : balance.toFixed(4)} <span className="text-xs font-normal">ℏ</span>
            </span>
          </div>
          <div className="flex items-baseline justify-between text-[11px] mb-1" style={{ color: "var(--ink-muted)" }}>
            <span>budget</span>
            <span>
              <span style={{ color: "var(--ink)" }}>{budget.spentHbar.toFixed(4)}</span> / {budget.capHbar.toFixed(4)} ℏ
            </span>
          </div>
          <div className="h-2 w-full rounded overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} aria-hidden />
          </div>
          <p className="mt-1 text-[10px]" style={{ color: "var(--ink-muted)" }}>
            {budget.remainingHbar.toFixed(4)} ℏ remaining
          </p>
        </section>
      </div>

      {/* live reasoning stream */}
      <section className="rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        <h2 className="text-xs uppercase tracking-widest mb-3 flex items-center justify-between" style={{ color: "var(--ink-muted)" }}>
          <span>Live reasoning</span>
          <span className="normal-case tracking-normal">{bought.length} bought · {events.length} events</span>
        </h2>

        {events.length === 0 && (
          <p className="text-xs py-6 text-center" style={{ color: "var(--ink-muted)" }}>
            {running ? "waiting for the agent to plan…" : "no run yet — set a goal above and hit Run."}
          </p>
        )}

        {/* the plan */}
        {plan && (
          <div className="row-in mb-4">
            <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--ink-muted)" }}>Plan · {plan.questions.length} sub-questions</div>
            <ol className="text-xs space-y-1">
              {plan.questions.map((q, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0" style={{ color: "var(--accent)" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ color: "var(--ink)" }}>{q}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* bought steps */}
        {bought.length > 0 && (
          <div className="space-y-3 mb-4">
            {bought.map((b, i) => (
              <div key={i} className="row-in rounded border p-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="text-xs font-bold" style={{ color: "var(--ink)" }}>» {b.question}</div>
                  <div className="shrink-0 text-[11px] text-right" style={{ color: "var(--ink-muted)" }}>
                    <div>
                      <span style={{ color: "var(--accent)" }}>{b.provider}</span> · {b.costHbar.toFixed(4)} ℏ
                    </div>
                    {b.hashscan && (
                      <a href={b.hashscan} target="_blank" rel="noreferrer" className="underline decoration-dotted" style={{ color: "var(--ink-muted)" }}>
                        payment ↗
                      </a>
                    )}
                  </div>
                </div>
                <p className="text-xs whitespace-pre-wrap" style={{ color: "var(--ink-muted)" }}>{b.answer}</p>
              </div>
            ))}
          </div>
        )}

        {/* budget exhausted */}
        {events.some((e) => e.type === "budget-exhausted") && (
          <div className="row-in mb-4 rounded border px-3 py-2 text-xs" style={{ borderColor: "#f59e0b", color: "#f59e0b", background: "rgb(245 158 11 / 0.08)" }}>
            budget exhausted — the agent stopped buying and is synthesizing with what it has.
          </div>
        )}

        {/* synthesis */}
        {synthesis && (
          <div className="row-in mb-4 rounded border p-3" style={{ borderColor: "var(--accent)", background: "rgb(34 197 94 / 0.06)" }}>
            <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: "var(--accent)" }}>Synthesis</div>
            <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{synthesis.answer}</p>
          </div>
        )}

        {/* done summary */}
        {done && (
          <div className="row-in flex flex-wrap gap-4 text-xs border-t pt-3" style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}>
            <span>✓ done</span>
            <span>total spent <span style={{ color: "var(--ink)" }}>{done.spentHbar.toFixed(4)} ℏ</span></span>
            <span>findings <span style={{ color: "var(--ink)" }}>{done.findings}</span></span>
          </div>
        )}

        {/* errors */}
        {errors.length > 0 && (
          <div className="mt-3 space-y-1">
            {errors.map((e, i) => (
              <div key={i} className="text-xs" style={{ color: "var(--danger)" }}>⚠ {e.message}</div>
            ))}
          </div>
        )}

        <div ref={streamEnd} />
      </section>

      <footer className="mt-4 text-[10px]" style={{ color: "var(--ink-muted)" }}>
        autonomous buyer agent · plans a goal into sub-questions, buys each answer from the exchange in HBAR via x402, then synthesizes · every payment is an on-chain Hedera tx · identity is an HCS-14 UAID
      </footer>
    </main>
  );
}
