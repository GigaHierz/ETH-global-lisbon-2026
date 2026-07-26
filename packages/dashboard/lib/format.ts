// Formatting for values that arrive over the wire.
//
// The dashboard renders whatever the exchange and agent-server hand it, and those
// deploy independently — so a field can legitimately be missing mid-rollout, or an
// error body (a proxy's JSON 502, say) can arrive where a row was expected. Calling
// .toFixed() straight on those values turns a cosmetic mismatch into a blank page:
// one undefined field throws inside a .map and React unmounts the whole route.
//
// So: never call .toFixed() directly on API data. Use these, which render an em dash
// for anything that isn't a finite number.

/** A numeric amount from the API, or "—" if it is missing/non-finite. */
export function amount(value: unknown, dp = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(dp) : "—";
}

/** Same, prefixed with the settlement symbol — "$1.23", or a bare "—" when unknown. */
export function money(symbol: string, value: unknown, dp = 2): string {
  const text = amount(value, dp);
  return text === "—" ? text : `${symbol}${text}`;
}

/** Sum a numeric field across rows, skipping anything non-finite. */
export function sumOf<T>(rows: T[], pick: (row: T) => unknown): number {
  return rows.reduce<number>((total, row) => {
    const v = pick(row);
    return typeof v === "number" && Number.isFinite(v) ? total + v : total;
  }, 0);
}
