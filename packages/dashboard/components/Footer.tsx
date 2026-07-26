const REPO = "https://github.com/GigaHierz/ETH-global-lisbon-2026";

// Footer link columns. One source of truth, rendered on every page.
const COLUMNS: Array<{ heading: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    heading: "Protocol",
    links: [
      { label: "Exchange Terminal", href: "/exchange" },
      { label: "Agent Demo", href: "/agent-demo" },
      { label: "Become a Provider", href: "/providers" },
      { label: "Trade Log (HCS)", href: "https://hashscan.io/testnet/topic/0.0.9744594", external: true },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "GitHub Repo", href: REPO, external: true },
      { label: "Docs", href: `${REPO}/blob/main/docs/GUIDE.md`, external: true },
      { label: "On-chain Proof", href: `${REPO}/blob/main/docs/PROOF.md`, external: true },
    ],
  },
  {
    heading: "Network",
    links: [
      { label: "Registry Topic", href: "https://hashscan.io/testnet/topic/0.0.9744593", external: true },
      { label: "Verdicts Topic", href: "https://hashscan.io/testnet/topic/0.0.9744595", external: true },
      { label: "Stake Escrow", href: "https://hashscan.io/testnet/account/0.0.9744157", external: true },
    ],
  },
];

/**
 * Shared site footer used on every page. Brand + testnet status on the left,
 * link columns on the right, copyright bar underneath — one source of truth
 * so the pages stay consistent.
 */
export default function Footer() {
  return (
    <footer className="bg-surface-obsidian border-t border-outline-variant w-full py-12">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 px-6 max-w-[1440px] mx-auto">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="AgentRouter logo" width={28} height={28} className="rounded-md" />
            <span className="font-data text-primary-fixed-dim font-bold text-lg">AgentRouter</span>
          </div>
          <p className="font-body text-sm text-on-surface-variant">The decentralized economy for AI intelligence.</p>
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-surface-container border border-outline-variant rounded-sm w-fit">
            <div className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
            <span className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface">Hedera Testnet Active</span>
          </div>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <h4 className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface mb-6">{col.heading}</h4>
            <ul className="space-y-4 font-data text-[11px] font-bold tracking-[0.1em]">
              {col.links.map((link) => (
                <li key={link.label}>
                  <a
                    className="text-on-surface-variant hover:text-accent-orange transition-colors"
                    href={link.href}
                    {...(link.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-12 pt-8 border-t border-outline-variant/30 text-center">
        <p className="font-data text-[11px] tracking-[0.1em] text-on-surface-variant opacity-50 uppercase">
          © 2026 AgentRouter Protocol. Built on Hedera at ETHGlobal Lisbon. Secured by Hashgraph.
        </p>
      </div>
    </footer>
  );
}
