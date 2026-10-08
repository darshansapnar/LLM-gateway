// Shared Recharts styling so every chart reads as one system. Colors are
// passed as CSS custom property references ("var(--color-series-1)") rather
// than hex literals - modern browsers resolve var() inside SVG presentation
// attributes, so charts repaint automatically when the dark mode toggle
// flips `data-theme` on <html>, with no JS re-render required.
export const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
];

export const CHART_GRID = "var(--color-chart-grid)";
export const CHART_AXIS = "var(--color-chart-axis)";
export const CHART_MUTED = "var(--color-chart-muted)";

export const AXIS_TICK_STYLE = { fontSize: 11, fill: "var(--color-chart-muted)" };

// Shared Recharts <Tooltip> styling (the content box itself still renders
// as an HTML div, so it uses real computed colors via a wrapper style).
export const TOOLTIP_CONTENT_STYLE = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--color-ink)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
};

export const TOOLTIP_LABEL_STYLE = { color: "var(--color-ink-soft)", marginBottom: 4 };
