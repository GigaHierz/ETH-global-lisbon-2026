"use client";

// Hands-on provider onboarding: the repo's `onboarding-a-provider` skill as a
// live page. Every step ships the exact command plus the check that proves it
// worked, and the last step checks the real exchange for your wallet.

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Card from "@/components/Card";
import Icon from "@/components/Icon";
import TerminalDots from "@/components/TerminalDots";
import { EXCHANGE } from "@/lib/config";

const REPO = "https://github.com/GigaHierz/ETH-global-lisbon-2026";

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="shrink-0 font-data text-[10px] tracking-[0.1em] uppercase px-2 py-1 border border-outline-variant text-on-surface-variant hover:text-accent-cyan hover:border-accent-cyan transition-colors"
      aria-label="Copy command"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

function Cmd({ children, label }: { children: string; label?: string }) {
  return (
    <div className="bg-surface-obsidian border border-outline-variant/60 rounded">
      {label && (
        <div className="px-3 py-1.5 border-b border-outline-variant/60 flex items-center justify-between">
          <span className="font-data text-[10px] tracking-[0.1em] uppercase text-on-surface-variant">{label}</span>
          <TerminalDots gapClassName="gap-1.5" dotClassName="w-2 h-2" />
        </div>
      )}
      <div className="flex items-start gap-3 p-3">
        <pre className="flex-1 font-data text-[12px] leading-relaxed text-on-surface overflow-x-auto whitespace-pre">{children}</pre>
        <Copy text={children} />
      </div>
    </div>
  );
}

interface Step {
  n: string;
  title: string;
  why: string;
  cmd: string;
  cmdLabel?: string;
  verify?: { text: string; cmd: string };
  note?: string;
}

const STEPS: Step[] = [
  {
    n: "01",
    title: "Clone and install",
    why: "The provider service is one package in the monorepo. Node 22+ and pnpm (corepack enable) are the only prerequisites — no GPU, no Docker required.",
    cmd: `git clone ${REPO.replace("https://", "")}\ncd ETH-global-lisbon-2026 && pnpm install`,
    cmdLabel: "terminal",
    verify: { text: "Workspace resolves and the provider package is present.", cmd: "pnpm --filter @agentrouter/provider exec node -e \"console.log('provider ok')\"" },
  },
  {
    n: "02",
    title: "Create your Hedera account",
    why: "Your provider IS a Hedera account — that's your identity, your payout address, and what holds your stake. There is no signup and no approval step.",
    cmd: `cp .env.example .env\n# add your funded operator credentials, then:\npnpm setup-hedera`,
    cmdLabel: "terminal",
    verify: { text: "The account exists and holds testnet HBAR (never print the key itself).", cmd: "grep -q '^HEDERA_PROVIDER_ID=.\\+' .env && echo 'account present' || echo MISSING" },
    note: "No operator account? Get testnet HBAR at portal.hedera.com (1000 ℏ/day), or ask the AgentRouter team to provision one for you.",
  },
  {
    n: "03",
    title: "Describe what you sell",
    why: "Name, model and price are your listing. Advertise exactly what you serve — the verifier replays sampled prompts against another provider of the same model, and serving something cheaper than advertised costs you your bond.",
    cmd: `PROVIDER_NAME="Acme Inference"\nPROVIDER_MODEL="llama-3.3-70b-versatile"\nPROVIDER_PRICE=0.08\nPROVIDER_PORT=4025\nPROVIDER_BACKEND=0g          # 0g (default) | groq | canned\nZEROG_API_KEY=...            # from pc.0g.ai — omit for canned demo answers`,
    cmdLabel: ".env",
    note: "Backends are pluggable: 0G Compute's decentralized GPU network (recommended) by default, or Groq. Without any key you still run — with deterministic canned answers, so you can try the whole flow in MOCK_MODE first (no keys, no funding) before going live on testnet.",
  },
  {
    n: "04",
    title: "Make yourself publicly reachable",
    why: "The endpoint you register is the endpoint the exchange calls. This is the single most common mistake: register localhost and you'll show as ○ down forever, because the exchange is probing its own machine.",
    cmd: `# any public URL works — VPS, Railway, or a tunnel:\ncloudflared tunnel --url http://localhost:4025\n\n# put the printed https:// URL in .env:\nPROVIDER_PUBLIC_URL=https://your-public-url`,
    cmdLabel: "terminal",
    verify: { text: "Your endpoint answers from the outside world.", cmd: "curl -s https://your-public-url/healthz" },
  },
  {
    n: "05",
    title: "Boot — staking and registration are automatic",
    why: "On first boot the service transfers a 50 ℏ quality bond to escrow and publishes an HCS-14 registration to the Hedera Consensus Service registry topic. Both are idempotent: restarts never double-stake.",
    cmd: "pnpm provider   # or `pnpm provider:prod` on a host that injects PORT",
    cmdLabel: "terminal",
    verify: { text: "The boot log prints your stake and registration transactions — open them on Hashscan.", cmd: "# look for: staked 50 ℏ → escrow  /  registered on HCS registry topic" },
  },
  {
    n: "06",
    title: "Verify you're live in the market",
    why: "The exchange reads the registry topic from Mirror Node (1–5s lag), probes your /info, and adds you to routing. Cheapest live provider for a model wins each request.",
    cmd: `curl -s ${EXCHANGE}/providers | jq '.[] | select(.displayName=="Acme Inference")'`,
    cmdLabel: "terminal",
    verify: { text: 'Your row shows "status": "live" — you are now earning per request.', cmd: "# use the checker below to confirm without leaving this page" },
  },
];

export default function OnboardPage() {
  const [name, setName] = useState("");
  const [result, setResult] = useState<null | { ok: boolean; msg: string; detail?: string }>(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    const q = name.trim().toLowerCase();
    if (!q) return;
    setChecking(true);
    setResult(null);
    try {
      const rows = (await (await fetch(`${EXCHANGE}/providers`)).json()) as Array<{
        displayName: string; model: string; price?: number; status: string; wallet: string; url: string;
      }>;
      const hit = rows.find(
        (r) => r.displayName?.toLowerCase().includes(q) || r.wallet?.toLowerCase() === q || r.url?.toLowerCase().includes(q),
      );
      if (!hit) {
        setResult({
          ok: false,
          msg: "Not found in the registry yet",
          detail: "Mirror Node lags 1–5s after registration. If it persists: check your boot log for the registration transaction, and confirm PROVIDER_PUBLIC_URL is your public URL (not localhost).",
        });
      } else if (hit.status === "live") {
        setResult({ ok: true, msg: `${hit.displayName} is LIVE`, detail: `${hit.model} · ${hit.price ?? "?"} per request · ${hit.wallet}` });
      } else {
        setResult({
          ok: false,
          msg: `${hit.displayName} is registered but ${hit.status.toUpperCase()}`,
          detail:
            hit.status === "slashed"
              ? "This provider was slashed for serving a different model than advertised."
              : `The exchange can't reach ${hit.url}. Make sure the service is running and PROVIDER_PUBLIC_URL is the public address, then restart.`,
        });
      }
    } catch {
      setResult({ ok: false, msg: "Couldn't reach the exchange", detail: `Tried ${EXCHANGE}/providers — it may be redeploying. Try again shortly.` });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-obsidian text-on-surface font-body selection:bg-accent-cyan selection:text-on-primary">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />

      <Navbar>
        <a href={REPO} target="_blank" rel="noreferrer"
          className="hidden sm:block font-data text-[11px] tracking-[0.1em] uppercase text-on-surface-variant hover:text-on-surface transition-colors">
          GitHub
        </a>
        <a href="/providers"
          className="bg-accent-orange text-on-primary px-4 py-1.5 font-data text-[11px] tracking-[0.1em] font-bold uppercase rounded-sm hover:shadow-[0_0_20px_rgba(255,107,0,0.4)] transition-all active:scale-95">
          Join as a Provider
        </a>
      </Navbar>

      <main className="pt-16 hud-grid-lines">
        {/* ── Hero ── */}
        <section className="px-4 max-w-4xl mx-auto pt-20 pb-12 text-center">
          <div className="inline-block px-3 py-1 mb-6 border border-outline-variant rounded-full bg-surface-container/50 backdrop-blur-md">
            <span className="font-data text-[11px] font-bold text-accent-orange uppercase tracking-widest">
              Permissionless · no signup · no approval
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[40px] leading-[46px] md:text-[64px] md:leading-[70px] tracking-[-0.04em] mb-5">
            Go live in <span className="text-accent-cyan">six steps</span>
          </h1>
          <p className="font-body text-base md:text-lg text-on-surface-variant max-w-2xl mx-auto">
            Sell LLM inference on AgentRouter and get paid per request over x402. Your Hedera
            account is your identity — boot the service and it stakes, registers on the Consensus
            Service, and enters routing on its own.
          </p>
          <a href="#agent-path"
            className="mt-6 inline-flex items-center gap-2 font-data text-[11px] tracking-[0.1em] uppercase font-bold text-primary-fixed-dim hover:text-accent-cyan transition-colors">
            <Icon name="smart_toy" className="text-[16px]" />
            Prefer an agent? Onboard via our MCP server or Claude skill
            <Icon name="arrow_downward" className="text-[14px]" />
          </a>
        </section>

        {/* ── Steps ── */}
        <section className="px-4 max-w-4xl mx-auto pb-8 space-y-5">
          {STEPS.map((s) => (
            <Card key={s.n} className="p-6 md:p-7">
              <div className="flex items-start gap-4 mb-4">
                <span className="font-data text-2xl text-accent-cyan/70 shrink-0 pt-0.5">{s.n}</span>
                <div>
                  <h2 className="font-display text-xl font-semibold mb-1.5">{s.title}</h2>
                  <p className="font-body text-sm text-on-surface-variant">{s.why}</p>
                </div>
              </div>
              <Cmd label={s.cmdLabel}>{s.cmd}</Cmd>
              {s.verify && (
                <div className="mt-3 pl-3 border-l-2 border-accent-cyan/40">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon name="check_circle" className="text-accent-cyan text-[16px]" />
                    <span className="font-data text-[10px] tracking-[0.1em] uppercase text-accent-cyan">Verify</span>
                  </div>
                  <p className="font-body text-[13px] text-on-surface-variant mb-2">{s.verify.text}</p>
                  <pre className="font-data text-[11px] text-on-surface-variant/80 overflow-x-auto whitespace-pre">{s.verify.cmd}</pre>
                </div>
              )}
              {s.note && (
                <p className="mt-3 font-body text-[13px] text-on-surface-variant/80 flex items-start gap-2">
                  <Icon name="info" className="text-accent-orange text-[16px] shrink-0 mt-0.5" />
                  <span>{s.note}</span>
                </p>
              )}
            </Card>
          ))}
        </section>

        {/* ── Live checker ── */}
        <section className="px-4 max-w-4xl mx-auto pb-12">
          <Card className="p-6 md:p-7 border-accent-cyan/40">
            <h2 className="font-display text-xl font-semibold mb-1.5">Am I live?</h2>
            <p className="font-body text-sm text-on-surface-variant mb-4">
              Checks the exchange&apos;s registry table for your provider — the same data routing uses.
              Enter your display name, Hedera account id, or public URL.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && check()}
                placeholder="Acme Inference — or 0.0.12345"
                className="flex-1 bg-surface-obsidian border border-outline-variant px-3 py-2 font-data text-sm outline-none focus:border-accent-cyan transition-colors"
              />
              <button
                onClick={check}
                disabled={checking || !name.trim()}
                className="bg-accent-cyan text-on-primary px-6 py-2 font-data text-[11px] tracking-[0.1em] uppercase font-bold disabled:opacity-40 hover:shadow-[0_0_20px_rgba(0,240,255,0.4)] transition-all active:scale-95"
              >
                {checking ? "Checking…" : "Check status"}
              </button>
            </div>
            {result && (
              <div className={`mt-4 p-4 border ${result.ok ? "border-accent-cyan/50 bg-accent-cyan/5" : "border-accent-orange/50 bg-accent-orange/5"}`}>
                <div className="flex items-center gap-2">
                  <Icon name={result.ok ? "check_circle" : "warning"} className={result.ok ? "text-accent-cyan" : "text-accent-orange"} />
                  <span className={`font-data text-sm font-bold ${result.ok ? "text-accent-cyan" : "text-accent-orange"}`}>{result.msg}</span>
                </div>
                {result.detail && <p className="mt-2 font-body text-[13px] text-on-surface-variant">{result.detail}</p>}
              </div>
            )}
          </Card>
        </section>

        {/* ── Agent path ── */}
        <section id="agent-path" className="px-4 max-w-4xl mx-auto pb-20 scroll-mt-20">
          <Card className="p-6 md:p-7">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-accent-orange flex items-center justify-center rounded-sm">
                <Icon name="smart_toy" className="text-on-primary" />
              </div>
              <h2 className="font-display text-xl font-semibold">Or let an agent do it</h2>
            </div>
            <p className="font-body text-sm text-on-surface-variant mb-4">
              The repo ships an <strong className="text-on-surface">MCP server</strong> that exposes every step above as
              agent-callable tools, and a Claude Code <strong className="text-on-surface">skill</strong> that walks you
              through it and verifies each step on-chain. Clone the repo, approve the MCP server once, and ask your
              agent to onboard you.
            </p>
            <Cmd label="one-call onboarding">{`provision_provider({\n  name: "Acme Inference",\n  model: "llama-3.3-70b-versatile",\n  price: 0.08,\n  publicUrl: "https://acme-inference.example.com"\n})`}</Cmd>
            <div className="mt-4 flex flex-wrap gap-4">
              <a href={`${REPO}/blob/main/packages/provider-mcp/README.md`} target="_blank" rel="noreferrer"
                className="font-data text-[11px] tracking-[0.1em] uppercase text-primary-fixed-dim hover:text-accent-cyan transition-colors">
                MCP server docs ↗
              </a>
              <a href={`${REPO}/blob/main/.claude/skills/onboarding-a-provider/SKILL.md`} target="_blank" rel="noreferrer"
                className="font-data text-[11px] tracking-[0.1em] uppercase text-primary-fixed-dim hover:text-accent-cyan transition-colors">
                Onboarding skill ↗
              </a>
              <a href={`${REPO}/blob/main/docs/provider.md`} target="_blank" rel="noreferrer"
                className="font-data text-[11px] tracking-[0.1em] uppercase text-primary-fixed-dim hover:text-accent-cyan transition-colors">
                Provider reference ↗
              </a>
            </div>
          </Card>
        </section>
      </main>

      <Footer />
    </div>
  );
}
