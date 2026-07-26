"use client";

// Which unit to render prices in. The exchange owns this — it's the service that
// actually prices and settles — so the dashboard asks rather than assuming.
//
// It starts on the default and corrects itself only if the exchange disagrees: the
// dashboard ships with no env vars and paints from SSE before this fetch resolves, so
// a pending or failed lookup must still render a sensible unit, never a blank one.

import { useEffect, useState } from "react";
import { EXCHANGE, DEFAULT_ASSET_SYMBOL } from "./config";

export function useAssetSymbol(): string {
  const [symbol, setSymbol] = useState(DEFAULT_ASSET_SYMBOL);
  useEffect(() => {
    fetch(`${EXCHANGE}/settlement`)
      .then((r) => r.json())
      .then((s: { symbol?: string }) => {
        if (s?.symbol) setSymbol(s.symbol);
      })
      .catch(() => {}); // unreachable exchange → keep the default
  }, []);
  return symbol;
}
