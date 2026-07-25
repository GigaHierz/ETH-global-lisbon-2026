"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// One source of truth for the primary navigation. Each item is a real page
// route with a `match` so the active underline follows the current route.
// Home (Protocol) is intentionally omitted — the logo already routes there.
const NAV_ITEMS: Array<{ label: string; href: string; match: string }> = [
  { label: "Exchange", href: "/exchange", match: "/exchange" },
  { label: "Agent", href: "/agent-demo", match: "/agent-demo" },
  { label: "Providers", href: "/providers", match: "/providers" },
];

/**
 * Shared top navigation used on every page. Left side (logo + links) is
 * identical everywhere; the logo always routes home. Page-specific content
 * (live stats, connection status, CTAs) is passed as `children` and rendered
 * on the right.
 */
export default function Navbar({ children }: { children?: ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 w-full z-50 bg-surface-obsidian/80 backdrop-blur-xl border-b border-outline-variant shadow-[0_0_40px_rgba(0,240,255,0.05)]">
      <div className="flex justify-between items-center h-16 px-6 w-full max-w-[1440px] mx-auto">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="font-display text-2xl font-bold text-accent-cyan tracking-tighter hover:opacity-80 transition-opacity"
          >
            AgentRouter
          </Link>
          <nav className="hidden lg:flex items-center gap-6 font-data text-sm">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.match;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={
                    active
                      ? "text-primary-fixed-dim border-b-2 border-accent-cyan pb-1"
                      : "text-on-surface-variant hover:text-on-surface transition-colors"
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {children && <div className="flex items-center gap-4">{children}</div>}
      </div>
    </header>
  );
}
