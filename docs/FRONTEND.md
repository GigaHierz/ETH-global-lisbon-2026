# Frontend and component guidelines (dashboard)

The dashboard (`packages/dashboard`) is a Next.js 15 / React 19 / Tailwind CSS 4 app. These
are the conventions every page must follow so the UI reads as one system and new pages don't
re-invent styling.

## One style source of truth

- All colors, fonts, spacing accents, chart colors, and shadows are **design tokens** declared
  in the Tailwind v4 `@theme` block in `app/globals.css`. Consume them as utilities
  (`bg-surface-obsidian`, `text-accent-cyan`, `glow-cyan`) — never hard-code hex values or
  arbitrary one-off utilities (`text-[#3b494b]`, `shadow-[0_0_20px_...]`) in a page.
- There is exactly one token set. Do not add a second `:root { ... }` palette.
- Recharts can't read Tailwind classes, so its colors live in `lib/chart.ts` (`CHART`,
  `SERIES_HEX`) as literal strings, each commented against the matching `@theme` token. Keep
  the two in sync; don't inline hex in a chart component.

## Compose shared components — don't rebuild markup

Reusable UI lives in `packages/dashboard/components/`. Compose these instead of copying JSX
between pages:

- `Navbar` — the top navigation (single `NAV_ITEMS` source; right side via `children`).
- `Icon` — Material Symbols icon.
- `Card` — the standard panel shell (`bg-surface-container border …`); pass extra classes via
  `className`.
- `StatusPill` — the "Hedera Testnet Active" style pill (variants: `nav`, `footer`, `hero`).
- `NavStats` — the nav stat strip; pass the `stats` array.
- `Footer` — the page footer (props for the tagline / centering differences).
- `TerminalDots` — terminal traffic-light dots.

If a block appears on more than one page, extract a component rather than duplicating it. Where
two instances differ, express the difference as a prop — don't fork the markup.

## Shared head and config

- Global `<head>` content (e.g. the Material Symbols stylesheet link) belongs in
  `app/layout.tsx`, not per page.
- Runtime config (the exchange / agent base URLs, with their env overrides and defaults) lives
  in `lib/config.ts`. Import from there; don't re-declare the constants per page.

## Settlement feed — the "TX in·out" column

The live settlement feed on the exchange page (`app/exchange/page.tsx`) ends each row with a
`TX in·out` column of up to three `Icon` links. The **direction of the arrow is the meaning** —
each points to one leg of the settlement on HashScan (see the two-legs model in
[`TRANSACTIONS.md`](./TRANSACTIONS.md)):

- **↙ `call_received`** → `hashscanTx(inboundRef)` — leg 1, **agent → exchange** (money in).
- **↗ `call_made`** → `hashscanTx(paymentRef)` — leg 2, **exchange → provider** (money out).
- **↩ `undo`** (orange, refunded rows only) → `hashscanTx(refundRef)` — the refund back to the agent.

Each icon renders only when its ref resolves to a valid HashScan tx link (`hashscanTx` returns
`null` for anything that isn't a `…@…` tx id); if none resolve the cell shows a plain `—`. Every
icon carries a `title` tooltip naming the leg, and the column header's `title` summarizes all
three — keep those in sync with this table if the icons change.

## Verifying

`pnpm --filter @agentrouter/dashboard build` must pass (types + lint + prerender). A styling or
component refactor should keep the same visual result — verify the pages render unchanged with
`pnpm dashboard`.
