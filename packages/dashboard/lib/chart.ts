// Recharts runs client-side and needs literal color strings (not CSS var()
// references). These mirror the chart-* tokens declared in app/globals.css
// (@theme --color-chart-*). Keep the two in sync — globals.css is the design
// source of truth; this file is its JS shadow for recharts.

export const CHART = {
  grid: "#3b494b", // --color-chart-grid   (== --color-outline-variant)
  axis: "#849495", // --color-chart-axis   (== --color-outline)
  tooltipBg: "#1a1b21", // --color-chart-tooltip-bg    (== --color-surface-container-low)
  tooltipLabel: "#b9cacb", // --color-chart-tooltip-label (== --color-on-surface-variant)
} as const;

// Per-model line colors. Mirror --color-chart-series-* in globals.css.
export const SERIES_HEX: Record<string, string> = {
  "llama-3.3-70b-versatile": "#00f0ff", // --color-chart-series-70b (== --color-accent-cyan)
  "llama-3.1-8b-instant": "#ff6b00", // --color-chart-series-8b (== --color-accent-orange)
};
