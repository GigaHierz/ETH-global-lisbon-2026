import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata = {
  title: "AgentRouter — Become a Provider",
  description:
    "Run a provider on AgentRouter: stake HBAR, register on Hedera Consensus Service, and earn HBAR for every LLM request you serve over x402.",
};

const REPO = "https://github.com/GigaHierz/ETH-global-lisbon-2026";
const WAITLIST =
  "mailto:sahilmarketingid@gmail.com?subject=AgentRouter%20Provider%20Waitlist&body=I%20want%20to%20list%20my%20compute%20on%20AgentRouter.%0A%0AHardware%3A%20%0AModels%20I%20can%20serve%3A%20%0AHedera%20account%20(if%20any)%3A%20";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`}>{name}</span>;
}

// Provider economics — sourced from provider/src/profiles.ts and GUIDE.md.
const STATS = [
  { icon: "payments", label: "Per 70B request", value: "0.10 ℏ" },
  { icon: "savings", label: "Quality bond", value: "50 ℏ" },
  { icon: "memory", label: "Backend", value: "Groq" },
  { icon: "hub", label: "Registry", value: "HCS on-chain" },
];

const STEPS = [
  {
    n: "01",
    icon: "cloud_upload",
    iconBg: "bg-accent-orange",
    iconColor: "text-on-primary",
    title: "List your compute",
    items: [
      "Run the provider service on any box — local GPU, VPS, or cloud.",
      "Point it at a Groq API key, or run without one for canned demo answers.",
      "Advertise the model you serve and a price in HBAR per request.",
    ],
  },
  {
    n: "02",
    icon: "verified_user",
    iconBg: "bg-accent-cyan",
    iconColor: "text-on-primary",
    title: "Stake & register",
    items: [
      "Boot stakes 50 ℏ into the escrow account as a quality bond.",
      "Registration is posted automatically to the HCS registry topic.",
      "The exchange discovers you from Mirror Node and adds you to routing.",
    ],
  },
  {
    n: "03",
    icon: "payments",
    iconBg: "bg-on-surface",
    iconColor: "text-surface-obsidian",
    title: "Serve & earn",
    items: [
      "Cheapest live provider for a model wins the request.",
      "x402 settles the payment in HBAR before you return the completion.",
      "Every settlement is an on-chain Hedera transaction — no invoicing.",
    ],
  },
];

const REQUIREMENTS = [
  {
    icon: "memory",
    title: "Minimum hardware",
    body: "Any box that can reach the Groq API — no local GPU required.",
  },
  {
    icon: "account_balance",
    title: "Quality bond",
    body: "50 ℏ staked to escrow — slashed if you serve a cheaper model than you advertise.",
  },
  {
    icon: "fingerprint",
    title: "Hedera account",
    body: "A testnet account ID + key per provider. The service registers your HCS-14 identity on boot.",
  },
  {
    icon: "public",
    title: "Reachable URL",
    body: "Set PROVIDER_PUBLIC_URL to a tunnel or VPS so the exchange can route requests to you.",
  },
];

// Env vars a provider sets — from GUIDE.md's configuration table.
const ENV_VARS: Array<[string, string, string]> = [
  ["HEDERA_PROVIDER1_ID", "from pnpm setup-hedera", "Account that stakes, registers, and receives payment."],
  ["HEDERA_PROVIDER1_KEY", "from pnpm setup-hedera", "Private key for that account."],
  ["PROVIDER_PUBLIC_URL", "http://localhost:4021", "Public address the exchange routes to."],
  ["GROQ_API_KEY", "—", "Upstream inference. Omitted → canned fallback answers."],
  ["STAKE_HBAR", "50", "Boot-time stake posted to escrow."],
];

// Public provider endpoints — from provider/src/index.ts.
const ENDPOINTS: Array<[string, string, string]> = [
  ["GET", "/info", "name, model, priceHbar, wallet, agentId, url"],
  ["GET", "/healthz", "liveness probe used by the exchange"],
  ["POST", "/v1/chat/completions", "402-gated inference — pay in HBAR, receive the completion"],
];

export default function ProvidersPage() {
  return (
    <div className="min-h-screen bg-surface-obsidian text-on-surface font-body selection:bg-accent-cyan selection:text-on-primary scroll-smooth">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />

      <Navbar>
        <a href={REPO} target="_blank" rel="noreferrer"
          className="hidden sm:block font-data text-[11px] tracking-[0.1em] uppercase text-on-surface-variant hover:text-on-surface transition-colors">
          GitHub
        </a>
        <a href={WAITLIST}
          className="bg-accent-orange text-on-primary px-4 py-1.5 font-data text-[11px] tracking-[0.1em] font-bold uppercase rounded-sm hover:shadow-[0_0_20px_rgba(255,107,0,0.4)] transition-all active:scale-95">
          Join Waitlist
        </a>
      </Navbar>

      <main className="relative pt-16 hud-grid-lines">
        {/* ── Hero ── */}
        <section className="relative flex flex-col items-center justify-center px-4 py-24 text-center overflow-hidden">
          <div className="relative z-10 max-w-4xl">
            <div className="inline-block px-3 py-1 mb-8 border border-outline-variant rounded-full bg-surface-container/50 backdrop-blur-md">
              <span className="font-data text-[11px] font-bold text-accent-orange uppercase tracking-widest">
                For Compute Providers
              </span>
            </div>
            <h1 className="font-display font-extrabold text-[42px] leading-[48px] md:text-[72px] md:leading-[80px] tracking-[-0.04em] mb-6 text-on-surface">
              Monetize Your <span className="text-accent-cyan">Compute</span>.
            </h1>
            <p className="font-body text-base md:text-xl text-on-surface-variant mb-12 max-w-2xl mx-auto">
              Turn an idle GPU or a spare API key into a high-yield asset. Stake HBAR, register on
              Hedera, and earn for every request the exchange routes your way.
            </p>
            <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
              <a href={WAITLIST}
                className="w-full md:w-auto bg-accent-orange text-on-primary px-10 py-4 font-data text-[11px] tracking-[0.1em] uppercase font-bold rounded-sm hover:shadow-[0_0_20px_rgba(255,107,0,0.4)] transition-all active:scale-95">
                Join the Provider Waitlist
              </a>
              <a href="#quickstart"
                className="w-full md:w-auto border border-outline-variant bg-surface-container/50 backdrop-blur-md text-on-surface px-10 py-4 font-data text-[11px] tracking-[0.1em] uppercase font-bold rounded-sm hover:bg-surface-variant transition-all">
                Read the quickstart
              </a>
            </div>
          </div>

          {/* Economics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-24 w-full max-w-6xl">
            {STATS.map((s) => (
              <div key={s.label}
                className="bg-surface-container border border-outline-variant p-6 rounded-sm glow-accent hover:border-accent-cyan transition-colors text-left">
                <div className="flex items-center gap-2 mb-2 text-on-surface-variant">
                  <Icon name={s.icon} className="text-[18px]" />
                  <span className="font-data text-[11px] font-bold tracking-[0.1em] uppercase">{s.label}</span>
                </div>
                <div className="font-data text-xl font-medium text-primary-fixed-dim">{s.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="py-24 px-4 max-w-[1440px] mx-auto">
          <h2 className="font-display text-2xl font-semibold text-center mb-16 text-on-surface uppercase tracking-widest">
            How Providers Earn
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {STEPS.map((step) => (
              <div key={step.n} className="relative bg-surface-container border border-outline-variant p-8 group">
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
              </div>
            ))}
          </div>
        </section>

        {/* ── Requirements ── */}
        <section className="bg-surface-container-lowest border-y border-outline-variant py-24">
          <div className="px-4 max-w-[1440px] mx-auto">
            <h2 className="font-display text-2xl font-semibold text-center mb-16 text-on-surface uppercase tracking-widest">
              What You Need
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {REQUIREMENTS.map((r) => (
                <div key={r.title} className="bg-surface-container border border-outline-variant p-6">
                  <div className="p-2 w-fit bg-surface-variant text-accent-cyan mb-4">
                    <Icon name={r.icon} />
                  </div>
                  <div className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface mb-2">{r.title}</div>
                  <p className="font-body text-sm text-on-surface-variant leading-relaxed">{r.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Quickstart ── */}
        <section id="quickstart" className="py-24 px-4 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
          <div className="flex flex-col h-full justify-center">
            <h2 className="font-display font-extrabold text-[36px] leading-[42px] md:text-5xl tracking-[-0.04em] mb-6 text-on-surface">
              Quickstart.
            </h2>
            <p className="font-body text-base text-on-surface-variant mb-8 max-w-lg">
              The terminal on the right is the whole onboarding. Clone, add your Hedera keys,
              make your box reachable, and start — the service stakes and registers itself.
            </p>
            <div className="space-y-3 font-body text-sm text-on-surface-variant">
              <div className="flex items-start gap-3">
                <Icon name="check_circle" className="text-accent-cyan text-[20px] shrink-0" />
                <span>No dashboard signup — registration happens on-chain at boot.</span>
              </div>
              <div className="flex items-start gap-3">
                <Icon name="check_circle" className="text-accent-cyan text-[20px] shrink-0" />
                <span>Run multiple profiles (<span className="font-data">provider1…provider4</span>) from one repo.</span>
              </div>
            </div>
            <a href={`${REPO}/blob/main/docs/GUIDE.md`} target="_blank" rel="noreferrer"
              className="mt-8 w-fit inline-flex items-center gap-2 font-data text-[11px] tracking-[0.1em] uppercase font-bold text-primary-fixed-dim hover:text-accent-cyan transition-colors">
              Full setup guide <Icon name="open_in_new" className="text-[14px]" />
            </a>
          </div>

          {/* Code terminal */}
          <div className="bg-surface-obsidian rounded-lg border border-outline/30 shadow-2xl overflow-hidden font-data text-sm">
            <div className="bg-surface-container px-4 py-3 border-b border-outline-variant flex items-center justify-between">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-hud-error/40" />
                <div className="w-3 h-3 rounded-full bg-accent-orange/40" />
                <div className="w-3 h-3 rounded-full bg-accent-cyan/40" />
              </div>
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
        </section>

        {/* ── Config + endpoints ── */}
        <section className="bg-surface-container-lowest border-y border-outline-variant py-24">
          <div className="px-4 max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Env vars */}
            <div>
              <h3 className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface mb-6">Configuration</h3>
              <div className="bg-surface-container border border-outline-variant overflow-x-auto">
                <table className="w-full text-left font-data text-[12px]">
                  <thead className="bg-surface-container-low text-on-surface-variant uppercase text-[9px]">
                    <tr>
                      <th className="px-4 py-3">Variable</th>
                      <th className="px-4 py-3">Default</th>
                      <th className="px-4 py-3">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {ENV_VARS.map(([name, def, purpose]) => (
                      <tr key={name} className="hover:bg-accent-cyan/5 transition-colors">
                        <td className="px-4 py-3 text-primary-fixed-dim whitespace-nowrap">{name}</td>
                        <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{def}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Endpoints */}
            <div>
              <h3 className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface mb-6">Provider Endpoints</h3>
              <div className="bg-surface-container border border-outline-variant overflow-x-auto">
                <table className="w-full text-left font-data text-[12px]">
                  <thead className="bg-surface-container-low text-on-surface-variant uppercase text-[9px]">
                    <tr>
                      <th className="px-4 py-3">Method</th>
                      <th className="px-4 py-3">Path</th>
                      <th className="px-4 py-3">Returns</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {ENDPOINTS.map(([method, path, returns]) => (
                      <tr key={path} className="hover:bg-accent-cyan/5 transition-colors">
                        <td className="px-4 py-3 text-accent-cyan whitespace-nowrap">{method}</td>
                        <td className="px-4 py-3 text-on-surface whitespace-nowrap">{path}</td>
                        <td className="px-4 py-3 text-on-surface-variant">{returns}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Slashing rule */}
              <div className="mt-6 bg-hud-error/10 border-l-2 border-hud-error p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="gavel" className="text-hud-error text-[18px]" />
                  <span className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-hud-error">Play fair or get slashed</span>
                </div>
                <p className="font-body text-sm text-on-surface-variant leading-relaxed">
                  The verifier replays sampled prompts against a witness provider. Serve a cheaper
                  model than you advertise and the divergence is caught — your 50 ℏ stake is seized to
                  the treasury and you&apos;re dropped from routing.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-24 px-4 text-center">
          <h2 className="font-display font-extrabold text-[32px] md:text-5xl tracking-[-0.04em] mb-6 text-on-surface">
            Ready to list your compute?
          </h2>
          <p className="font-body text-base text-on-surface-variant mb-10 max-w-2xl mx-auto">
            Join the provider waitlist, or clone the repo and run <span className="font-data text-primary-fixed-dim">pnpm provider1</span> right now.
          </p>
          <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
            <a href={WAITLIST}
              className="w-full md:w-auto bg-accent-orange text-on-primary px-10 py-4 font-data text-[11px] tracking-[0.1em] uppercase font-bold rounded-sm hover:shadow-[0_0_20px_rgba(255,107,0,0.4)] transition-all active:scale-95">
              Join the Provider Waitlist
            </a>
            <a href={REPO} target="_blank" rel="noreferrer"
              className="w-full md:w-auto border border-outline-variant bg-surface-container/50 text-on-surface px-10 py-4 font-data text-[11px] tracking-[0.1em] uppercase font-bold rounded-sm hover:bg-surface-variant transition-all">
              View the repo
            </a>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <Footer />
    </div>
  );
}
