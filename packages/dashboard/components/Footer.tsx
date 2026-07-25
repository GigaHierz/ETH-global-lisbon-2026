import type { ReactNode } from "react";
import StatusPill from "@/components/StatusPill";

// Slim page footer shared by /exchange and /agent-demo. Only the tagline text
// (and whether it's centered) differs between the two, so those are props.
// The landing page uses its own richer footer and is intentionally not this.
export default function Footer({
  tagline,
  centered = false,
}: {
  tagline: ReactNode;
  centered?: boolean;
}) {
  return (
    <footer className="w-full py-8 bg-surface-obsidian border-t border-outline-variant">
      <div className="px-6 max-w-[1440px] mx-auto flex flex-col md:flex-row justify-between gap-4 items-center">
        <span className="font-data text-primary-fixed-dim">AgentRouter Protocol</span>
        <span className={`font-data text-[10px] tracking-[0.1em] text-on-surface-variant uppercase${centered ? " text-center" : ""}`}>
          {tagline}
        </span>
        <StatusPill variant="footer" />
      </div>
    </footer>
  );
}
