"use client";

import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Icon from "@/components/Icon";
import Card from "@/components/Card";
import TerminalDots from "@/components/TerminalDots";
import Footer from "@/components/Footer";
import { EXCHANGE } from "@/lib/config";

const REPO = "https://github.com/GigaHierz/ETH-global-lisbon-2026";

// Real on-chain receipts (PROOF.md)
const PROOF_LINKS: Array<{ label: string; href: string; color: "cyan" | "orange" }> = [
  { label: "Agent Settlement", href: "https://hashscan.io/testnet/transaction/0.0.7162784@1784982277.193217949", color: "cyan" },
  { label: "Provider Settlement", href: "https://hashscan.io/testnet/transaction/0.0.7162784@1784982283.158991431", color: "cyan" },
  { label: "Slash: escrow→treasury", href: "https://hashscan.io/testnet/transaction/0.0.9744157@1784983556.547115247", color: "cyan" },
  { label: "HCS Topic: Registry", href: "https://hashscan.io/testnet/topic/0.0.9744593", color: "orange" },
  { label: "HCS Topic: Trades", href: "https://hashscan.io/testnet/topic/0.0.9744594", color: "orange" },
  { label: "HCS Topic: Verdicts", href: "https://hashscan.io/testnet/topic/0.0.9744595", color: "orange" },
];

function MarqueeRow() {
  return (
    <div className="flex gap-12 items-center px-6 shrink-0">
      <span className="font-data text-[11px] font-bold tracking-[0.1em] text-on-surface-variant uppercase whitespace-nowrap">
        Network Integrity:
      </span>
      {PROOF_LINKS.map((l) => (
        <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
          className={`flex items-center gap-2 font-data text-[11px] font-bold tracking-[0.1em] hover:underline whitespace-nowrap ${
            l.color === "cyan" ? "text-accent-cyan" : "text-accent-orange"
          }`}>
          {l.label} <Icon name="open_in_new" className="text-[12px]" />
        </a>
      ))}
    </div>
  );
}

const STEPS = [
  {
    n: "01", icon: "dns", iconBg: "bg-accent-orange", iconColor: "text-on-primary", title: "Providers list",
    items: [
      "Run the provider service on your local machine or any cloud box.",
      "Stake 50 ℏ to the escrow account as a quality bond.",
      "Registration is automatically posted to the HCS registry topic.",
    ],
  },
  {
    n: "02", icon: "shopping_cart", iconBg: "bg-accent-cyan", iconColor: "text-on-primary", title: "Agents buy",
    items: [
      "Agent requests a specific model from the global exchange.",
      "Exchange routes the request to the cheapest available provider.",
      "x402 protocol fires: pay ℏ → receive LLM completion.",
    ],
  },
  {
    n: "03", icon: "gavel", iconBg: "bg-on-surface", iconColor: "text-surface-obsidian", title: "Verifier enforces",
    items: [
      "Random sampling: prompts are replayed against a shadow provider.",
      "Divergence in output tokens triggers a verification event.",
      "Escrow stake is seized and the cheater is dropped from routing.",
    ],
  },
];

export default function Landing() {
  const [stats, setStats] = useState<{ volume: string; requests: string; providers: string; avgPrice: string }>({
    volume: "—", requests: "—", providers: "—", avgPrice: "—",
  });

  useEffect(() => {
    Promise.all([
      fetch(`${EXCHANGE}/providers`).then((r) => r.json()).catch(() => []),
      fetch(`${EXCHANGE}/log?limit=100`).then((r) => r.json()).catch(() => []),
    ]).then(([providers, log]: [Array<{ status: string }>, Array<{ status: string; priceHbar: number }>]) => {
      const ok = (log ?? []).filter((e) => e.status === "ok");
      const vol = ok.reduce((s, e) => s + e.priceHbar, 0);
      setStats({
        volume: `${vol.toFixed(2)} ℏ`,
        requests: String(ok.length),
        providers: String((providers ?? []).filter((p) => p.status === "live").length),
        avgPrice: ok.length ? `${(vol / ok.length).toFixed(3)} ℏ` : "—",
      });
    }).catch(() => {});
  }, []);

  const STAT_CARDS = [
    { icon: "database", label: "Total Volume", value: stats.volume },
    { icon: "bolt", label: "Requests Served", value: stats.requests },
    { icon: "hub", label: "Providers Live", value: stats.providers },
    { icon: "payments", label: "Avg Price", value: stats.avgPrice },
  ];

  return (
    <div className="min-h-screen bg-surface-obsidian text-on-surface font-body selection:bg-accent-cyan selection:text-on-primary scroll-smooth">
      {/* ── Top Navigation ── */}
      <Navbar>
        <a href={REPO} target="_blank" rel="noreferrer"
          className="hidden sm:block font-data text-[11px] tracking-[0.1em] uppercase text-on-surface-variant hover:text-on-surface transition-colors">
          GitHub
        </a>
        <a href="/exchange"
          className="bg-primary text-on-primary px-4 py-1.5 font-data text-[11px] tracking-[0.1em] font-bold uppercase rounded-sm hover:bg-accent-cyan transition-colors active:scale-95">
          Launch App
        </a>
      </Navbar>

      <main className="relative pt-16 hud-grid-lines">
        {/* ── Hero ── */}
        <section className="relative min-h-[85vh] flex flex-col items-center justify-center px-4 py-24 text-center overflow-hidden">
          <div className="relative z-10 max-w-4xl">
            <div className="inline-block px-3 py-1 mb-8 border border-outline-variant rounded-full bg-surface-container/50 backdrop-blur-md">
              <span className="font-data text-[11px] font-bold text-accent-orange uppercase tracking-widest">
                Protocol Live on Hedera Testnet
              </span>
            </div>
            <h1 className="font-display font-extrabold text-[42px] leading-[48px] md:text-[84px] md:leading-[92px] tracking-[-0.04em] mb-6 text-on-surface">
              Agent<span className="text-accent-cyan">Router</span>
            </h1>
            <p className="font-body text-base md:text-xl text-on-surface-variant mb-12 max-w-2xl mx-auto">
              A spot market where AI agents buy LLM inference per request in HBAR on Hedera.
              Low latency. Zero trust. Infinite scale.
            </p>
            <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
              <a href="/exchange"
                className="w-full md:w-auto bg-accent-cyan text-on-primary px-10 py-4 font-data text-[11px] tracking-[0.1em] uppercase font-bold rounded-sm hover:glow-cyan transition-all">
                View the market
              </a>
              <a href="/providers"
                className="w-full md:w-auto border border-outline-variant bg-surface-container/50 backdrop-blur-md text-on-surface px-10 py-4 font-data text-[11px] tracking-[0.1em] uppercase font-bold rounded-sm hover:bg-surface-variant transition-all">
                List your GPU
              </a>
            </div>
          </div>

          {/* Live stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-24 w-full max-w-6xl">
            {STAT_CARDS.map((s) => (
              <Card key={s.label}
                className="p-6 rounded-sm glow-accent hover:border-accent-cyan transition-colors text-left">
                <div className="flex items-center gap-2 mb-2 text-on-surface-variant">
                  <Icon name={s.icon} className="text-[18px]" />
                  <span className="font-data text-[11px] font-bold tracking-[0.1em] uppercase">{s.label}</span>
                </div>
                <div className="font-data text-xl font-medium text-primary-fixed-dim">{s.value}</div>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Proof marquee ── */}
        <div className="w-full bg-surface-container-low py-4 border-y border-outline-variant overflow-hidden">
          <div className="animate-marquee">
            <MarqueeRow />
            <MarqueeRow />
          </div>
        </div>

        {/* ── Protocol Architecture ── */}
        <section className="py-24 px-4 max-w-[1440px] mx-auto">
          <h2 className="font-display text-2xl font-semibold text-center mb-16 text-on-surface uppercase tracking-widest">
            Protocol Architecture
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step) => (
              <Card key={step.n} className="relative p-8 group">
                <span className="absolute top-4 right-6 font-data text-8xl text-outline-variant/30 select-none group-hover:text-accent-cyan/40 transition-colors">
                  {step.n}
                </span>
                <div className="relative z-10">
                  <div className={`w-12 h-12 ${step.iconBg} flex items-center justify-center rounded-sm mb-6`}>
                    <Icon name={step.icon} className={step.iconColor} />
                  </div>
                  <h3 className="font-display text-2xl font-semibold mb-4 text-on-surface">{step.title}</h3>
                  <ul className="space-y-4 font-body text-sm text-on-surface-variant">
                    {step.items.map((item) => (
                      <li key={item} className="flex items-start gap-3">
                        <Icon name="check_circle" className="text-accent-cyan text-[20px] shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* ── List your GPU ── */}
        <section className="bg-surface-container-lowest border-y border-outline-variant py-24" id="list-gpu">
          <div className="px-4 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div className="flex flex-col h-full justify-center">
              <h2 className="font-display font-extrabold text-[42px] leading-[48px] md:text-5xl tracking-[-0.04em] mb-6 text-on-surface">
                Monetize Your Compute.
              </h2>
              <p className="font-body text-base text-on-surface-variant mb-8 max-w-lg">
                Turn your idle RTX or H100 into a high-yield asset. Join the decentralized backbone
                of AI inference and earn HBAR for every request served.
              </p>
              <div className="space-y-4">
                <Card className="flex items-center gap-4 p-4">
                  <div className="p-2 bg-surface-variant text-accent-cyan">
                    <Icon name="memory" />
                  </div>
                  <div>
                    <div className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface">Minimum Hardware</div>
                    <div className="font-data text-sm text-on-surface-variant">Any box — Groq/Ollama backend, 8GB VRAM for local models</div>
                  </div>
                </Card>
                <Card className="flex items-center gap-4 p-4">
                  <div className="p-2 bg-surface-variant text-accent-cyan">
                    <Icon name="verified_user" />
                  </div>
                  <div>
                    <div className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface">Quality Bond</div>
                    <div className="font-data text-sm text-on-surface-variant">50 ℏ stake — slashed if you serve a cheaper model than advertised</div>
                  </div>
                </Card>
              </div>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <a href="mailto:sahilmarketingid@gmail.com?subject=AgentRouter%20Provider%20Waitlist&body=I%20want%20to%20list%20my%20compute%20on%20AgentRouter.%0A%0AHardware%3A%20%0AModels%20I%20can%20serve%3A%20%0AHedera%20account%20(if%20any)%3A%20"
                  className="bg-accent-orange text-on-primary px-10 py-4 font-data text-[11px] tracking-[0.1em] uppercase font-bold rounded-sm hover:glow-orange transition-all active:scale-95">
                  Join the Provider Waitlist
                </a>
                <a href="/providers"
                  className="font-data text-[11px] tracking-[0.1em] uppercase font-bold text-primary-fixed-dim hover:text-accent-cyan transition-colors">
                  Read the provider docs →
                </a>
              </div>
            </div>

            {/* Code terminal — the real onboarding */}
            <div className="bg-surface-obsidian rounded-lg border border-outline/30 shadow-2xl overflow-hidden font-data text-sm">
              <div className="bg-surface-container px-4 py-3 border-b border-outline-variant flex items-center justify-between">
                <TerminalDots gapClassName="gap-2" dotClassName="w-3 h-3" />
                <span className="text-on-surface-variant text-[11px] uppercase tracking-widest">provision.sh — bash</span>
              </div>
              <div className="p-6 space-y-4 text-[13px]">
                <div>
                  <span className="text-accent-orange"># 1. Clone and install</span><br />
                  <span className="text-on-surface">git clone {REPO.replace("https://", "")} &amp;&amp; pnpm install</span>
                </div>
                <div>
                  <span className="text-accent-orange"># 2. Add your Hedera keys to .env</span><br />
                  <span className="text-on-surface">HEDERA_PROVIDER1_ID=0.0.xxxxx · HEDERA_PROVIDER1_KEY=0x…</span>
                </div>
                <div>
                  <span className="text-accent-orange"># 3. Make your box reachable</span><br />
                  <span className="text-on-surface">PROVIDER_PUBLIC_URL=https://your-tunnel-or-vps</span>
                </div>
                <div>
                  <span className="text-accent-orange"># 4. Start — stakes 50 ℏ + registers on HCS automatically</span><br />
                  <span className="text-on-surface">pnpm provider1</span>
                </div>
                <div className="pt-4 mt-4 border-t border-outline-variant">
                  <span className="text-accent-cyan font-bold italic">{"// unpaid request → the paywall answers"}</span><br />
                  <span className="text-on-surface">curl -X POST localhost:4021/v1/chat/completions \</span><br />
                  <span className="text-on-surface ml-4">-d {"'"}{"{"}&quot;model&quot;:&quot;llama-3.3-70b-versatile&quot;,…{"}"}{"'"}</span>
                </div>
                <div className="bg-hud-error/10 p-3 border-l-2 border-hud-error">
                  <span className="text-hud-error font-bold">HTTP/1.1 402 Payment Required</span><br />
                  <span className="text-on-surface-variant text-[12px]">scheme: exact · network: hedera:testnet</span><br />
                  <span className="text-on-surface-variant text-[12px]">amount: 10000000 tinybars · payTo: 0.0.9744152</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <Footer />
    </div>
  );
}
