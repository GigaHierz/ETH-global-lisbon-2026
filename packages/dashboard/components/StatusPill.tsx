// "Hedera Testnet Active" style status pill. Three shells appear in the app:
//  - "footer": exchange + agent-demo page footers (static cyan dot)
//  - "nav":    exchange + agent-demo navbar connection indicator (dynamic dot/label)
//  - "hero":   landing-page footer badge (bolder, self-sizing)
type Variant = "footer" | "nav" | "hero";

export default function StatusPill({
  variant = "footer",
  label = "Hedera Testnet Active",
  dotClassName = "bg-accent-cyan",
}: {
  variant?: Variant;
  label?: string;
  dotClassName?: string;
}) {
  if (variant === "nav") {
    return (
      <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-high rounded-full border border-outline-variant">
        <span className={`w-2 h-2 rounded-full ${dotClassName} animate-pulse`} />
        <span className="font-data text-[10px] text-on-surface-variant uppercase tracking-widest">{label}</span>
      </div>
    );
  }

  if (variant === "hero") {
    return (
      <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-surface-container border border-outline-variant rounded-sm w-fit">
        <span className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
        <span className="font-data text-[11px] font-bold tracking-[0.1em] uppercase text-on-surface">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-surface-container border border-outline-variant rounded-sm">
      <span className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
      <span className="font-data text-[10px] uppercase text-on-surface">{label}</span>
    </div>
  );
}
