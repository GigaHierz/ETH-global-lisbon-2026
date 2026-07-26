"use client";

// Hidden operator console — deliberately NOT linked in the Navbar. Open this on a
// phone/second screen and drive the slash story while the /exchange page is being
// presented elsewhere; the buttons hit the same guarded endpoints, so the banner and
// table update live on whatever screen is showing /exchange (via that page's SSE).

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { EXCHANGE, VERIFIER, DEMO_TOKEN } from "@/lib/config";

const CHEATER = "SketchyGPU Labs";

interface CheaterRow {
  displayName: string;
  status: "live" | "down" | "slashed";
  stakeHbar: number;
  bondStatus: "active" | "frozen" | "wiped";
  bondTokens: number;
}

type Busy = null | "slash" | "reset" | "real";

export default function RearmConsole() {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [cheater, setCheater] = useState<CheaterRow | null>(null);
  const [conn, setConn] = useState<"connecting" | "live" | "offline">("connecting");
  const [realSlash, setRealSlash] = useState<{
    provider: string;
    hashscan: { slash: string | null; wipe: string | null; freeze: string | null };
  } | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const pickCheater = (rows: CheaterRow[]) => rows.find((p) => p.displayName === CHEATER) ?? null;

  useEffect(() => {
    fetch(`${EXCHANGE}/providers`).then((r) => r.json()).then((rows) => setCheater(pickCheater(rows))).catch(() => {});
    const es = new EventSource(`${EXCHANGE}/events`);
    esRef.current = es;
    es.onopen = () => setConn("live");
    es.onerror = () => setConn("offline");
    es.onmessage = (msg) => {
      let ev: { type: string; providers?: CheaterRow[] };
      try { ev = JSON.parse(msg.data); } catch { return; }
      if (ev.type === "providers" && ev.providers) setCheater(pickCheater(ev.providers));
    };
    return () => es.close();
  }, []);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(DEMO_TOKEN ? { "x-demo-token": DEMO_TOKEN } : {}),
  };

  async function post(base: string, path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: "{}" });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error((body.error as string) || `HTTP ${res.status}`);
    return body;
  }

  async function run(kind: Busy, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const runSlashDemo = () =>
    run("slash", async () => {
      setRealSlash(null);
      await post(EXCHANGE, "/demo/reset");
      await post(EXCHANGE, "/demo/slash");
    });

  const resetDemo = () =>
    run("reset", async () => {
      setRealSlash(null);
      await post(EXCHANGE, "/demo/reset");
    });

  const runRealSlash = () =>
    run("real", async () => {
      const body = await post(VERIFIER, "/demo/real-slash");
      setRealSlash({
        provider: String(body.provider ?? CHEATER),
        hashscan: (body.hashscan as { slash: string | null; wipe: string | null; freeze: string | null }) ?? {
          slash: null, wipe: null, freeze: null,
        },
      });
    });

  const slashed = cheater?.status === "slashed";
  const connDot = conn === "live" ? "bg-accent-cyan" : conn === "connecting" ? "bg-accent-orange" : "bg-hud-error";

  return (
    <div className="min-h-screen bg-surface-obsidian text-on-surface font-body flex items-center justify-center p-5">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center justify-between">
          <span className="font-data text-[11px] tracking-[0.2em] text-accent-orange uppercase">Operator · Demo Control</span>
          <span className="flex items-center gap-1.5 font-data text-[10px] text-on-surface-variant uppercase">
            <span className={`w-2 h-2 rounded-full ${connDot}`} /> {conn}
          </span>
        </div>

        {/* Live cheater status */}
        <div className="border border-outline-variant bg-surface-container p-5">
          <span className="font-data text-[10px] tracking-[0.1em] text-on-surface-variant block mb-2">TARGET</span>
          <div className="flex items-center justify-between">
            <span className={`font-data text-lg font-bold ${slashed ? "text-hud-error" : "text-on-surface"}`}>{CHEATER}</span>
            <span
              className={`px-2 py-1 font-data text-[11px] font-bold uppercase ${
                slashed ? "bg-hud-error text-surface-obsidian" : "bg-accent-cyan/10 text-primary-fixed-dim"
              }`}
            >
              {cheater ? cheater.status : "—"}
            </span>
          </div>
          {cheater && (
            <div className="mt-3 flex gap-6 font-data text-[11px] text-on-surface-variant">
              <span>stake <span className="text-on-surface">{cheater.stakeHbar} ℏ</span></span>
              <span>bond <span className={cheater.bondStatus === "wiped" ? "text-hud-error line-through" : "text-on-surface"}>{cheater.bondTokens} ARBOND</span></span>
            </div>
          )}
        </div>

        {/* Controls */}
        <button
          onClick={runSlashDemo}
          disabled={busy !== null}
          className="w-full bg-hud-error text-white px-4 py-4 font-data text-sm tracking-[0.1em] uppercase font-bold disabled:opacity-40 hover:brightness-110 transition-all active:scale-95"
        >
          {busy === "slash" ? "slashing…" : "⚡ Run slash demo"}
        </button>
        <div className="flex gap-3">
          <button
            onClick={resetDemo}
            disabled={busy !== null}
            className="flex-1 border border-outline-variant text-on-surface-variant px-4 py-3 font-data text-xs tracking-[0.1em] uppercase disabled:opacity-40 hover:border-accent-cyan hover:text-on-surface transition-colors"
          >
            {busy === "reset" ? "resetting…" : "↺ Reset"}
          </button>
          <button
            onClick={runRealSlash}
            disabled={busy !== null}
            title="Genuine on-chain slash via the verifier (real Hedera tx)"
            className="flex-1 border border-accent-orange/60 text-accent-orange px-4 py-3 font-data text-xs tracking-[0.1em] uppercase disabled:opacity-40 hover:bg-accent-orange/10 transition-colors"
          >
            {busy === "real" ? "on-chain…" : "⛓ Real slash"}
          </button>
        </div>

        <p className="font-body text-[11px] text-on-surface-variant leading-tight">
          <b>Run slash demo</b> resets then stages the slash — instant &amp; repeatable, appears live on the /exchange screen.
          <b> Real slash</b> seizes stake and wipes the HTS bond on Hedera (real tx).
        </p>

        {error && <p className="font-data text-xs text-hud-error">⚠ {error}</p>}

        {realSlash && (
          <div className="border-t border-outline-variant pt-3 space-y-1">
            <span className="font-data text-[11px] text-accent-cyan block">✓ REAL SLASH — {realSlash.provider}</span>
            {([
              ["stake seized", realSlash.hashscan.slash],
              ["bond wiped", realSlash.hashscan.wipe],
              ["bond frozen", realSlash.hashscan.freeze],
            ] as const).map(([label, href]) =>
              href ? (
                <a key={label} href={href} target="_blank" rel="noreferrer"
                  className="font-data text-[11px] text-primary-fixed-dim hover:text-accent-cyan block">
                  {label} <Icon name="open_in_new" className="text-[11px]" />
                </a>
              ) : (
                <span key={label} className="font-data text-[11px] text-on-surface-variant/60 block">{label}: no tx (mock/off-chain)</span>
              ),
            )}
          </div>
        )}

        <p className="font-data text-[9px] text-on-surface-variant/50 break-all pt-2">
          exchange: {EXCHANGE.replace(/^https?:\/\//, "")} · token: {DEMO_TOKEN ? "set" : "none"}
        </p>
      </div>
    </div>
  );
}
