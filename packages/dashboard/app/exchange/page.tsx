"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import Navbar from "@/components/Navbar";
import Icon from "@/components/Icon";
import Card from "@/components/Card";
import NavStats from "@/components/NavStats";
import StatusPill from "@/components/StatusPill";
import Footer from "@/components/Footer";
import { EXCHANGE } from "@/lib/config";
import { useAssetSymbol } from "@/lib/settlement";
import { amount, money, sumOf } from "@/lib/format";
import { CHART, SERIES_HEX } from "@/lib/chart";

// ---- types mirrored from @agentrouter/shared (kept local: dashboard is standalone) ----
interface ProviderRow {
  displayName: string; model: string; price: number; wallet: string;
  agentId: string | null; url: string; status: "live" | "down" | "slashed";
  reputation: number; stakeHbar: number; requestsServed: number;
  // HTS ReputationBond (ARBOND) — on-chain reputation; verifier freezes then wipes on fraud
  bondTokens: number; bondStatus: "active" | "frozen" | "wiped";
}
interface RequestLogEntry {
  id: string; ts: number; model: string; provider: string; price: number;
  fee?: number; total?: number; inboundRef?: string; refundRef?: string;
  latencyMs: number; paymentRef: string; promptPreview: string; answerPreview: string;
  status: "ok" | "error" | "refunded";
}
interface SlashEvent { provider: string; amountHbar: number; reason: string }
interface AuditMsg { topic: string; consensusTs: string; sequence: number; payload: Record<string, unknown> | null }
interface TopicInfo { id: string | null; hashscan: string | null }
interface VerifyEvent { provider: string; witness: string; similarity: number; verdict: "ok" | "divergent" }
interface ExchangeStats { totalVolume: number; requests: number; feeRevenue: number; refunds: number; refundFailures: number; feeBps: number; asset?: string }

// Same rule as lib/format: these take wire data, so they must tolerate a missing
// or non-string value rather than throwing inside a .map and unmounting the route.
const hashscanTx = (ref: unknown) =>
  typeof ref === "string" && ref.includes("@")
    ? `https://hashscan.io/testnet/transaction/${ref}`
    : null;
const hashscanAccount = (id: unknown) =>
  typeof id === "string" && id.startsWith("0.0.")
    ? `https://hashscan.io/testnet/account/${id}`
    : null;

export default function ExchangeControlRoom() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [feed, setFeed] = useState<RequestLogEntry[]>([]);
  const [prices, setPrices] = useState<Array<{ ts: number; model: string; price: number }>>([]);
  const [slash, setSlash] = useState<SlashEvent | null>(null);
  const [verifies, setVerifies] = useState<VerifyEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [topics, setTopics] = useState<Record<string, TopicInfo> | null>(null);
  const [auditMock, setAuditMock] = useState(true);
  const [audit, setAudit] = useState<AuditMsg[]>([]);
  const [activeTopic, setActiveTopic] = useState<"registry" | "trades" | "verdicts">("trades");
  const [stats, setStats] = useState<ExchangeStats | null>(null);
  const slashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sym = useAssetSymbol();

  useEffect(() => {
    fetch(`${EXCHANGE}/providers`).then((r) => r.json()).then(setProviders).catch(() => {});
    fetch(`${EXCHANGE}/log?limit=50`).then((r) => r.json()).then((l) => setFeed(l.reverse())).catch(() => {});
    fetch(`${EXCHANGE}/price-index`).then((r) => r.json()).then(setPrices).catch(() => {});
    fetch(`${EXCHANGE}/stats`).then((r) => r.json()).then(setStats).catch(() => {});

    const es = new EventSource(`${EXCHANGE}/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      if (ev.type === "providers") setProviders(ev.providers);
      if (ev.type === "request") {
        // The exchange emits this twice per trade: once when the row is created and
        // again after the agent's payment settles, to attach the inbound tx id. So
        // upsert on id — blindly prepending renders the same trade twice, which is
        // indistinguishable from the market genuinely doing double the volume.
        setFeed((f) => {
          const i = f.findIndex((e) => e.id === ev.entry.id);
          if (i >= 0) {
            const next = [...f];
            next[i] = ev.entry;
            return next;
          }
          return [ev.entry, ...f].slice(0, 60);
        });
        // ...and only chart the first sighting, or the price index double-counts too.
        setPrices((p) =>
          p.some((x) => x.ts === ev.entry.ts && x.model === ev.entry.model)
            ? p
            : [...p.slice(-499), { ts: ev.entry.ts, model: ev.entry.model, price: ev.entry.price }],
        );
      }
      if (ev.type === "slashed") {
        setSlash({ provider: ev.provider, amountHbar: ev.amountHbar, reason: ev.reason });
        if (slashTimer.current) clearTimeout(slashTimer.current);
        slashTimer.current = setTimeout(() => setSlash(null), 30000);
      }
      if (ev.type === "verify") setVerifies((v) => [ev, ...v].slice(0, 10));
      if (ev.type === "stats") setStats(ev.stats);
      if (ev.type === "bond") {
        setProviders((ps) => ps.map((p) =>
          String(p.wallet ?? "").toLowerCase() === String(ev.wallet ?? "").toLowerCase()
            ? { ...p, bondTokens: ev.bondTokens, bondStatus: ev.bondStatus }
            : p,
        ));
      }
    };
    return () => es.close();
  }, []);

  // ---- HCS audit trail: topic ids from the exchange, messages straight from Mirror Node ----
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    fetch(`${EXCHANGE}/topics`).then((r) => r.json()).then((t) => {
      setAuditMock(t.mock);
      setTopics(t.topics);
      if (t.mock) return;
      const poll = async () => {
        const out: AuditMsg[] = [];
        for (const name of ["trades", "verdicts", "registry"]) {
          const id = t.topics[name]?.id;
          if (!id) continue;
          try {
            const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/topics/${id}/messages?order=desc&limit=8`);
            const body = await res.json();
            for (const m of body.messages ?? []) {
              let payload = null;
              try { payload = JSON.parse(atob(m.message)); } catch {}
              out.push({ topic: name, consensusTs: m.consensus_timestamp, sequence: m.sequence_number, payload });
            }
          } catch {}
        }
        out.sort((a, b) => parseFloat(b.consensusTs) - parseFloat(a.consensusTs));
        setAudit(out.slice(0, 24));
      };
      poll();
      timer = setInterval(poll, 5000); // mirror lag is 1-5s; 5s poll is honest
    }).catch(() => {});
    return () => { if (timer) clearInterval(timer); };
  }, []);

  // Bucket price points into 5s windows, avg per model → chart rows
  const chartData = useMemo(() => {
    const buckets = new Map<number, Record<string, { sum: number; n: number }>>();
    for (const p of prices) {
      if (typeof p.price !== "number" || !Number.isFinite(p.price)) continue; // never plot NaN
      const b = Math.floor(p.ts / 5000) * 5000;
      const row = buckets.get(b) ?? {};
      const cell = row[p.model] ?? { sum: 0, n: 0 };
      cell.sum += p.price; cell.n += 1;
      row[p.model] = cell; buckets.set(b, row);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .slice(-40)
      .map(([ts, row]) => {
        const out: Record<string, number | string> = {
          t: new Date(ts).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" }),
        };
        for (const [model, { sum, n }] of Object.entries(row)) out[model] = +(sum / n * 100).toFixed(2);
        return out;
      });
  }, [prices]);

  const models = useMemo(() => [...new Set(prices.map((p) => p.model))], [prices]);
  // The chart plots hundredths of a unit (see chartData), so the axis unit is the
  // settlement asset's "cent": ¢ for USDC, cℏ for HBAR.
  const centLabel = sym === "$" ? "¢" : `c${sym}`;
  const okFeed = feed.filter((f) => f.status === "ok");
  const totalVolume = sumOf(okFeed, (f) => f.price);
  const liveCount = providers.filter((p) => p.status === "live").length;
  const avgPrice = okFeed.length ? totalVolume / okFeed.length : 0;
  const topicMsgs = audit.filter((m) => m.topic === activeTopic);

  return (
    <div className="min-h-screen bg-surface-obsidian text-on-surface hud-grid-bg font-body selection:bg-accent-cyan/30">
      {/* ── Top Navigation ── */}
      <Navbar>
        <NavStats
          stats={[
            ["VOLUME", money(sym, totalVolume, 2), "text-primary-fixed-dim"],
            ["REQUESTS", String(okFeed.length), "text-primary-fixed-dim"],
            ["PROVIDERS", String(liveCount), "text-primary-fixed-dim"],
            ["AVG PRICE", money(sym, avgPrice, 3), "text-primary-fixed-dim"],
            ["EXCHANGE REVENUE", money(sym, stats?.feeRevenue, 4), "text-accent-orange"],
          ]}
        />
        <StatusPill
          variant="nav"
          dotClassName={connected ? "bg-accent-cyan" : "bg-hud-error"}
          label={connected ? "Hedera Testnet" : "Feed Down"}
        />
      </Navbar>

      <main className="pt-24 pb-12 px-6 max-w-[1440px] mx-auto space-y-6">
        {/* ── SLASHED alert banner ── */}
        {slash && (
          <div role="alert" className="slashed-stripes w-full py-3 px-6 border-y border-hud-error shadow-[0_0_30px_rgba(147,0,10,0.3)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <Icon name="warning" className="text-white animate-bounce" />
                <span className="font-data text-sm tracking-[0.15em] font-bold text-white uppercase truncate">
                  ALERT: PROVIDER SLASHED — {slash.provider} — {slash.amountHbar} ℏ seized
                </span>
              </div>
              <div className="font-data text-xs text-white/70 shrink-0 hidden md:block">{slash.reason}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* ── Sidebar ── */}
          <div className="lg:col-span-3 space-y-6">
            {/* Session card */}
            <Card className="p-5 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Icon name="account_balance_wallet" className="text-8xl" />
              </div>
              <div className="relative z-10">
                <span className="font-data text-[11px] tracking-[0.1em] text-on-surface-variant mb-1 block">EXCHANGE SESSION</span>
                <div className="flex items-center gap-2 mb-4">
                  <span className="font-data text-primary-fixed-dim text-sm">{EXCHANGE.replace(/^https?:\/\//, "").slice(0, 28)}</span>
                </div>
                <div className="space-y-4">
                  <div>
                    <span className="font-data text-[10px] tracking-[0.1em] text-on-surface-variant block">SESSION VOLUME</span>
                    <span className="font-data text-3xl font-bold text-on-surface"><span className="text-primary-fixed-dim">{sym}</span>{amount(totalVolume, 2)}</span>
                  </div>
                  <div className="pt-4 border-t border-outline-variant flex justify-between">
                    <div>
                      <span className="font-data text-[9px] tracking-[0.1em] text-on-surface-variant block">SETTLED</span>
                      <span className="font-data text-sm">{okFeed.length} reqs</span>
                    </div>
                    <div className="text-right">
                      <span className="font-data text-[9px] tracking-[0.1em] text-on-surface-variant block">MODE</span>
                      <span className="font-data text-sm">{auditMock ? "MOCK" : "ON-CHAIN"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Price index chart */}
            <Card className="p-5">
              <div className="flex justify-between items-center mb-4">
                <span className="font-data text-[11px] tracking-[0.1em]">PRICE INDEX ({centLabel}/REQ)</span>
                <Icon name="trending_up" className="text-primary-fixed-dim text-sm" />
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke={CHART.grid} strokeOpacity={0.3} strokeDasharray="2 4" vertical={false} />
                    <XAxis dataKey="t" tick={{ fill: CHART.axis, fontSize: 9, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={{ stroke: CHART.grid }} />
                    <YAxis tick={{ fill: CHART.axis, fontSize: 9, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ background: CHART.tooltipBg, border: `1px solid ${CHART.grid}`, fontSize: 11, fontFamily: "JetBrains Mono" }}
                      labelStyle={{ color: CHART.tooltipLabel }}
                      formatter={(v: number, name: string) => [`${v}${centLabel}`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} iconType="plainline" />
                    {models.map((m) => (
                      <Line key={m} type="stepAfter" dataKey={m} stroke={SERIES_HEX[m] ?? CHART.axis}
                        strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 font-body text-[11px] text-on-surface-variant leading-tight">
                Cheapest live claimant wins routing. Watch the step when fraud exits the market.
              </p>
            </Card>
          </div>

          {/* ── Main column ── */}
          <div className="lg:col-span-9 space-y-6">
            {/* Provider registry */}
            <Card id="providers" className="overflow-hidden">
              <div className="p-4 border-b border-outline-variant flex justify-between items-center">
                <span className="font-data text-[11px] tracking-[0.1em]">PROVIDER REGISTRY</span>
                <span className="bg-accent-cyan/10 text-primary-fixed-dim px-2 py-0.5 rounded font-data text-[10px]">
                  HCS 0.0.9744593 · MIRROR-DISCOVERED
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-data text-sm">
                  <thead className="bg-surface-container-low text-on-surface-variant uppercase text-[10px]">
                    <tr>
                      <th className="px-6 py-3 font-bold">Provider</th>
                      <th className="px-6 py-3 font-bold">Model</th>
                      <th className="px-6 py-3 font-bold text-right">Price</th>
                      <th className="px-6 py-3 font-bold text-right">Stake</th>
                      <th className="px-6 py-3 font-bold text-right">Rep</th>
                      <th className="px-6 py-3 font-bold text-center">Bond</th>
                      <th className="px-6 py-3 font-bold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {providers.map((p) => (
                      <tr key={p.url} className={
                        p.status === "slashed"
                          ? "bg-hud-error-container/10 border-l-2 border-hud-error"
                          : "hover:bg-accent-cyan/5 transition-colors"
                      }>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className={`font-bold ${p.status === "slashed" ? "text-hud-error" : "text-on-surface"}`}>{p.displayName}</span>
                            {hashscanAccount(p.wallet) ? (
                              <a className={`text-[10px] hover:underline ${p.status === "slashed" ? "text-hud-error/60" : "text-primary-fixed-dim"}`}
                                href={hashscanAccount(p.wallet)!} target="_blank" rel="noreferrer">
                                {p.wallet} (Hashscan)
                              </a>
                            ) : (
                              <span className="text-[10px] text-on-surface-variant">{p.wallet}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-on-surface-variant">{p.model}</td>
                        <td className={`px-6 py-4 text-right ${p.status === "slashed" ? "opacity-50" : ""}`}>{money(sym, p.price, 2)}</td>
                        <td className={`px-6 py-4 text-right ${p.status === "slashed" ? "text-hud-error font-bold" : ""}`}>{amount(p.stakeHbar, 0)} ℏ</td>
                        <td className={`px-6 py-4 text-right ${p.status === "slashed" ? "text-hud-error" : "text-accent-cyan"}`}>{p.reputation}%</td>
                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold ${p.bondStatus === "wiped" ? "text-hud-error line-through" : p.bondStatus === "frozen" ? "text-accent-orange" : "text-on-surface"}`}>
                              {p.bondTokens} ARBOND
                            </span>
                            {p.bondStatus === "active" && <span className="px-2 py-0.5 bg-accent-cyan/10 text-primary-fixed-dim text-[9px] rounded-sm">BONDED</span>}
                            {p.bondStatus === "frozen" && <span className="px-2 py-0.5 bg-accent-orange/20 text-accent-orange text-[9px] rounded-sm">🔒 FROZEN</span>}
                            {p.bondStatus === "wiped" && <span className="px-2 py-0.5 bg-hud-error text-surface-obsidian font-bold text-[9px] rounded-sm">WIPED</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {p.status === "live" && <span className="px-2 py-1 bg-accent-cyan/20 text-accent-cyan text-[10px] rounded-sm">LIVE</span>}
                          {p.status === "down" && <span className="px-2 py-1 bg-surface-variant text-on-surface-variant text-[10px] rounded-sm">DOWN</span>}
                          {p.status === "slashed" && <span className="px-2 py-1 bg-hud-error text-surface-obsidian font-bold text-[10px] rounded-sm">SLASHED</span>}
                        </td>
                      </tr>
                    ))}
                    {providers.length === 0 && (
                      <tr><td colSpan={7} className="px-6 py-8 text-center text-on-surface-variant">scanning HCS registry…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Verifier + audit trail */}
            <div id="audit" className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Verifier audit log */}
              <Card className="p-5 space-y-4 relative hud-scanline overflow-hidden">
                <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                  <span className="font-data text-[11px] tracking-[0.1em]">VERIFIER AUDIT LOG</span>
                  <span className="font-data text-[10px] text-on-surface-variant">THRESHOLD: 0.35</span>
                </div>
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                  {verifies.map((v, i) => v.verdict === "ok" ? (
                    <div key={i} className="p-3 bg-surface-container-low border border-outline-variant/30 text-xs font-data">
                      <div className="flex justify-between mb-2">
                        <span className="font-bold">{v.provider} <span className="text-on-surface-variant font-normal">vs {v.witness}</span></span>
                        <span className="text-accent-cyan font-bold">PASS</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-on-surface-variant">
                        <span>Sim Score: {amount(v.similarity, 2)}</span>
                        <span>Thresh: 0.35</span>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="p-3 bg-hud-error-container/20 border border-hud-error/50 text-xs font-data">
                      <div className="flex justify-between mb-2">
                        <span className="font-bold text-hud-error">{v.provider}</span>
                        <span className="text-hud-error font-bold">VERDICT: FRAUD</span>
                      </div>
                      <p className="text-hud-error/80">
                        Divergence vs witness {v.witness} — similarity {amount((v.similarity ?? 0) * 100, 0)}% &lt; 35%
                      </p>
                    </div>
                  ))}
                  {verifies.length === 0 && (
                    <div className="p-3 text-xs font-data text-on-surface-variant">no audits yet — the verifier samples routed requests</div>
                  )}
                </div>
              </Card>

              {/* On-chain audit trail */}
              <Card className="flex flex-col">
                <div className="flex border-b border-outline-variant">
                  {(["registry", "trades", "verdicts"] as const).map((name) => (
                    <button key={name} onClick={() => setActiveTopic(name)}
                      className={`flex-1 py-3 font-data text-[10px] tracking-[0.1em] uppercase border-r last:border-r-0 border-outline-variant transition-colors ${
                        activeTopic === name ? "bg-surface-container-high text-primary-fixed-dim" : "hover:bg-surface-variant text-on-surface-variant"
                      }`}>
                      {name}
                    </button>
                  ))}
                </div>
                <div className="flex-1 p-4 font-data text-[11px] space-y-3 max-h-[280px] overflow-y-auto">
                  {auditMock && <p className="text-on-surface-variant">mock mode — no chain. Live consensus log appears in on-chain mode.</p>}
                  {!auditMock && topicMsgs.map((m) => (
                    <div key={`${m.topic}-${m.sequence}`} className="p-3 bg-surface-container-lowest rounded border border-outline-variant/50">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-accent-cyan">TOPIC: {topics?.[m.topic]?.id}</span>
                        <span className="text-on-surface-variant">SEQ: {m.sequence}</span>
                      </div>
                      <pre className="text-on-surface-variant/80 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
{JSON.stringify(m.payload, null, 1)?.slice(0, 400)}
                      </pre>
                    </div>
                  ))}
                  {!auditMock && topicMsgs.length === 0 && (
                    <p className="text-on-surface-variant">waiting for consensus messages… (mirror lag 1-5s)</p>
                  )}
                </div>
                {topics?.[activeTopic]?.hashscan && (
                  <div className="p-3 border-t border-outline-variant bg-surface-container-low text-center">
                    <a className="font-data text-[10px] tracking-[0.1em] text-primary-fixed-dim hover:text-white transition-colors"
                      href={topics[activeTopic]!.hashscan!} target="_blank" rel="noreferrer">
                      EXPLORE TOPIC ON HASHSCAN →
                    </a>
                  </div>
                )}
              </Card>
            </div>

            {/* Live settlement feed */}
            <Card>
              <div className="p-4 border-b border-outline-variant flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${connected ? "bg-accent-cyan" : "bg-hud-error"} animate-pulse`} />
                  <span className="font-data text-[11px] tracking-[0.1em]">LIVE SETTLEMENT FEED</span>
                </div>
                <span className="font-data text-[10px] text-on-surface-variant uppercase">{connected ? "Stream Active" : "Reconnecting…"}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-data text-[12px]">
                  <thead className="bg-surface-container-low text-on-surface-variant uppercase text-[9px]">
                    <tr>
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Provider</th>
                      <th className="px-4 py-2">Model</th>
                      <th className="px-4 py-2">Prompt</th>
                      <th className="px-4 py-2 text-right">Price ({sym})</th>
                      <th className="px-4 py-2 text-right">Fee ({sym})</th>
                      <th className="px-4 py-2 text-right">Total ({sym})</th>
                      <th className="px-4 py-2 text-right">Lat.</th>
                      <th className="px-4 py-2 text-center">Status</th>
                      <th className="px-4 py-2 text-right">TX in·out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {feed.slice(0, 20).map((r) => (
                      <tr key={r.id} className={`row-in hover:bg-surface-variant/50 ${r.status === "refunded" ? "bg-accent-orange/5" : ""}`}>
                        <td className="px-4 py-3 text-on-surface-variant">{new Date(r.ts).toLocaleTimeString()}</td>
                        <td className={`px-4 py-3 ${r.status === "error" ? "text-hud-error" : "text-primary-fixed-dim"}`}>{r.provider}</td>
                        <td className="px-4 py-3 opacity-70">{String(r.model ?? "—").replace("-versatile", "").replace("-instant", "")}</td>
                        <td className="px-4 py-3 text-on-surface-variant max-w-[220px] truncate">{r.promptPreview}</td>
                        <td className="px-4 py-3 text-right">{amount(r.price, 3)}</td>
                        <td className="px-4 py-3 text-right text-accent-orange">{amount(r.fee, 3)}</td>
                        <td className="px-4 py-3 text-right">{amount(r.total, 3)}</td>
                        <td className="px-4 py-3 text-right text-accent-cyan">{r.status === "ok" ? `${r.latencyMs}ms` : "--"}</td>
                        <td className="px-4 py-3 text-center">
                          {r.status === "ok" && <span className="text-accent-cyan">SETTLED</span>}
                          {r.status === "error" && <span className="text-hud-error">FAILED</span>}
                          {r.status === "refunded" && (
                            <span className="px-1.5 py-0.5 bg-accent-orange/20 text-accent-orange rounded-sm">REFUNDED</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          {r.inboundRef && hashscanTx(r.inboundRef) && (
                            <a className="text-on-surface-variant hover:text-accent-cyan" title="agent→exchange settlement"
                              href={hashscanTx(r.inboundRef)!} target="_blank" rel="noreferrer">
                              <Icon name="call_received" className="text-[14px]" />
                            </a>
                          )}
                          {hashscanTx(r.paymentRef) && (
                            <a className="text-on-surface-variant hover:text-accent-cyan" title="exchange→provider settlement"
                              href={hashscanTx(r.paymentRef)!} target="_blank" rel="noreferrer">
                              <Icon name="call_made" className="text-[14px]" />
                            </a>
                          )}
                          {r.refundRef && hashscanTx(r.refundRef) && (
                            <a className="text-accent-orange hover:text-on-surface" title="refund to agent"
                              href={hashscanTx(r.refundRef)!} target="_blank" rel="noreferrer">
                              <Icon name="undo" className="text-[14px]" />
                            </a>
                          )}
                          {!r.inboundRef && !hashscanTx(r.paymentRef) && !r.refundRef && <span className="text-on-surface-variant/40">—</span>}
                        </td>
                      </tr>
                    ))}
                    {feed.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-on-surface-variant font-data">no settlements yet — send a request through the exchange</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
