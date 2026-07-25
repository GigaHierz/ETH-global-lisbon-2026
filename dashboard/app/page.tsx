"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const EXCHANGE = process.env.NEXT_PUBLIC_EXCHANGE_URL || "http://localhost:4100";

// ---- types mirrored from @agentrouter/shared (kept local: dashboard is standalone) ----
interface ProviderRow {
  displayName: string; model: string; priceHbar: number; wallet: string;
  agentId: string | null; url: string; status: "live" | "down" | "slashed";
  reputation: number; stakeHbar: number; requestsServed: number;
}
interface RequestLogEntry {
  id: string; ts: number; model: string; provider: string; priceHbar: number;
  latencyMs: number; paymentRef: string; promptPreview: string; answerPreview: string;
  status: "ok" | "error";
}
interface SlashEvent { provider: string; amountHbar: number; reason: string }
interface VerifyEvent { provider: string; witness: string; similarity: number; verdict: "ok" | "divergent" }

const SERIES: Record<string, string> = {
  "llama-3.3-70b-versatile": "var(--series-70b)",
  "llama-3.1-8b-instant": "var(--series-8b)",
};
const SERIES_HEX: Record<string, string> = {
  "llama-3.3-70b-versatile": "#059669",
  "llama-3.1-8b-instant": "#0369a1",
};

export default function Home() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [feed, setFeed] = useState<RequestLogEntry[]>([]);
  const [prices, setPrices] = useState<Array<{ ts: number; model: string; priceHbar: number }>>([]);
  const [slash, setSlash] = useState<SlashEvent | null>(null);
  const [verifies, setVerifies] = useState<VerifyEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const slashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`${EXCHANGE}/providers`).then((r) => r.json()).then(setProviders).catch(() => {});
    fetch(`${EXCHANGE}/log?limit=50`).then((r) => r.json()).then((l) => setFeed(l.reverse())).catch(() => {});
    fetch(`${EXCHANGE}/price-index`).then((r) => r.json()).then(setPrices).catch(() => {});

    const es = new EventSource(`${EXCHANGE}/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      if (ev.type === "providers") setProviders(ev.providers);
      if (ev.type === "request") {
        setFeed((f) => [ev.entry, ...f].slice(0, 60));
        setPrices((p) => [...p.slice(-499), { ts: ev.entry.ts, model: ev.entry.model, priceHbar: ev.entry.priceHbar }]);
      }
      if (ev.type === "slashed") {
        setSlash({ provider: ev.provider, amountHbar: ev.amountHbar, reason: ev.reason });
        if (slashTimer.current) clearTimeout(slashTimer.current);
        slashTimer.current = setTimeout(() => setSlash(null), 30000);
      }
      if (ev.type === "verify") setVerifies((v) => [ev, ...v].slice(0, 10));
    };
    return () => es.close();
  }, []);

  // Bucket price points into 5s windows, avg per model → chart rows
  const chartData = useMemo(() => {
    const buckets = new Map<number, Record<string, { sum: number; n: number }>>();
    for (const p of prices) {
      const b = Math.floor(p.ts / 5000) * 5000;
      const row = buckets.get(b) ?? {};
      const cell = row[p.model] ?? { sum: 0, n: 0 };
      cell.sum += p.priceHbar; cell.n += 1;
      row[p.model] = cell; buckets.set(b, row);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .slice(-40)
      .map(([ts, row]) => {
        const out: Record<string, number | string> = {
          t: new Date(ts).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        };
        for (const [model, { sum, n }] of Object.entries(row)) out[model] = +(sum / n * 1000).toFixed(3);
        return out;
      });
  }, [prices]);

  const models = useMemo(() => [...new Set(prices.map((p) => p.model))], [prices]);
  const totalVolume = feed.filter((f) => f.status === "ok").reduce((s, f) => s + f.priceHbar, 0);

  return (
    <main className="min-h-screen p-4 max-w-[1400px] mx-auto">
      {/* header */}
      <header className="flex items-baseline justify-between border-b pb-3 mb-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--accent)" }}>AGENTROUTER</h1>
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>inference exchange · x402 · ERC-8004 · base sepolia</span>
        </div>
        <div className="text-xs flex gap-4" style={{ color: "var(--ink-muted)" }}>
          <span>session vol <span style={{ color: "var(--ink)" }}>${totalVolume.toFixed(4)}</span></span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: connected ? "var(--accent)" : "var(--danger)" }} aria-hidden />
            {connected ? "feed live" : "feed down"}
          </span>
        </div>
      </header>

      {/* SLASHED banner */}
      {slash && (
        <div role="alert" className="slash-banner w-full mb-4 rounded px-4 py-3 text-white font-bold flex items-center gap-3 text-sm">
          <span className="text-lg" aria-hidden>⚡</span>
          <span>SLASHED — {slash.provider} lost ${slash.amountHbar.toFixed(2)} stake · {slash.reason} · removed from routing</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* provider table */}
        <section className="lg:col-span-2 rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--ink-muted)" }}>Providers</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: "var(--ink-muted)" }}>
                <th className="py-1 pr-2 font-normal">name</th>
                <th className="py-1 pr-2 font-normal">model</th>
                <th className="py-1 pr-2 font-normal text-right">$/req</th>
                <th className="py-1 pr-2 font-normal text-right">stake</th>
                <th className="py-1 pr-2 font-normal text-right">rep</th>
                <th className="py-1 pr-2 font-normal text-right">served</th>
                <th className="py-1 font-normal">status</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.url} className="border-t" style={{
                  borderColor: "var(--border)",
                  opacity: p.status === "slashed" ? 0.55 : 1,
                  textDecoration: p.status === "slashed" ? "line-through" : "none",
                }}>
                  <td className="py-1.5 pr-2">
                    <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: SERIES_HEX[p.model] ?? "var(--ink-muted)" }} aria-hidden />
                    {p.displayName}
                  </td>
                  <td className="py-1.5 pr-2" style={{ color: "var(--ink-muted)" }}>{p.model}</td>
                  <td className="py-1.5 pr-2 text-right">${p.priceHbar.toFixed(4)}</td>
                  <td className="py-1.5 pr-2 text-right">${p.stakeHbar.toFixed(2)}</td>
                  <td className="py-1.5 pr-2 text-right">{p.reputation}</td>
                  <td className="py-1.5 pr-2 text-right">{p.requestsServed}</td>
                  <td className="py-1.5">
                    {p.status === "live" && <span style={{ color: "var(--accent)" }}>● live</span>}
                    {p.status === "down" && <span style={{ color: "var(--ink-muted)" }}>○ down</span>}
                    {p.status === "slashed" && <span style={{ color: "var(--danger)" }}>⚡ slashed</span>}
                  </td>
                </tr>
              ))}
              {providers.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center" style={{ color: "var(--ink-muted)" }}>waiting for providers…</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* verifier activity */}
        <section className="rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--ink-muted)" }}>Verifier</h2>
          <ul className="text-xs space-y-1.5">
            {verifies.map((v, i) => (
              <li key={i} className="row-in flex justify-between gap-2">
                <span className="truncate">{v.provider} <span style={{ color: "var(--ink-muted)" }}>vs {v.witness}</span></span>
                <span style={{ color: v.verdict === "ok" ? "var(--accent)" : "var(--danger)" }}>
                  {(v.similarity * 100).toFixed(0)}% {v.verdict === "ok" ? "✓" : "✗ DIVERGENT"}
                </span>
              </li>
            ))}
            {verifies.length === 0 && <li style={{ color: "var(--ink-muted)" }}>no audits yet</li>}
          </ul>
        </section>

        {/* price index chart */}
        <section className="lg:col-span-2 rounded border p-3" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--ink-muted)" }}>
            Price index <span className="normal-case">(avg paid, m$/req, 5s buckets)</span>
          </h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="t" tick={{ fill: "#6b8577", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={{ fill: "#6b8577", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", fontSize: 11, fontFamily: "inherit" }}
                  labelStyle={{ color: "var(--ink-muted)" }}
                  formatter={(v: number, name: string) => [`${v} m$/req`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                {models.map((m) => (
                  <Line key={m} type="stepAfter" dataKey={m} stroke={SERIES_HEX[m] ?? "#6b8577"}
                    strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* live request feed */}
        <section className="rounded border p-3 overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
          <h2 className="text-xs uppercase tracking-widest mb-2" style={{ color: "var(--ink-muted)" }}>Request feed</h2>
          <ul className="text-[11px] space-y-1.5 max-h-56 overflow-y-auto">
            {feed.map((r) => (
              <li key={r.id} className="row-in border-b pb-1" style={{ borderColor: "var(--border)" }}>
                <div className="flex justify-between gap-2">
                  <span className="truncate" style={{ color: r.status === "error" ? "var(--danger)" : "var(--ink)" }}>
                    {r.provider}
                  </span>
                  <span className="shrink-0" style={{ color: "var(--ink-muted)" }}>
                    ${r.priceHbar.toFixed(4)} · {r.latencyMs}ms
                  </span>
                </div>
                <div className="truncate" style={{ color: "var(--ink-muted)" }}>» {r.promptPreview}</div>
              </li>
            ))}
            {feed.length === 0 && <li style={{ color: "var(--ink-muted)" }}>no requests yet</li>}
          </ul>
        </section>
      </div>

      <footer className="mt-4 text-[10px]" style={{ color: "var(--ink-muted)" }}>
        agents pay per request in USDC via x402 · providers registered in ERC-8004 identity registry · verifier replays sampled prompts and slashes divergent providers
      </footer>
    </main>
  );
}
