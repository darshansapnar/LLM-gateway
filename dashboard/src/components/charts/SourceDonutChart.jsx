import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { SERIES, TOOLTIP_CONTENT_STYLE } from "../../lib/chartTheme.js";
import { formatNumber } from "../../lib/format.js";
import EmptyState from "../common/EmptyState.jsx";

const PROVIDER_LABELS = { groq: "Groq", gemini: "Gemini", openrouter: "OpenRouter" };

// Where answers actually came from: exact cache / semantic cache / each
// live provider. Exact + semantic counts come from the overview KPIs;
// provider counts come from the providers endpoint's attempt-based
// requestCount - an approximation (a retried request's extra attempts can
// inflate a provider's slice slightly beyond its true share of requests).
export default function SourceDonutChart({ overview, providers }) {
  const total = overview.totalRequests;
  const slices = [
    { name: "Exact cache", value: Math.round(overview.exactHitRate * total) },
    { name: "Semantic cache", value: Math.round(overview.semanticHitRate * total) },
    ...Object.entries(providers)
      .filter(([, stats]) => stats.requestCount > 0)
      .map(([name, stats]) => ({ name: PROVIDER_LABELS[name] || name, value: stats.requestCount })),
  ].filter((slice) => slice.value > 0);

  const grandTotal = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-medium text-ink">Where answers came from</h3>
      {slices.length > 0 ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <div className="h-[220px] w-full shrink-0 sm:w-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                >
                  {slices.map((_, index) => (
                    <Cell key={index} fill={SERIES[index % SERIES.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP_CONTENT_STYLE}
                  formatter={(value, name) => [`${formatNumber(value)} requests`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="flex w-full flex-col gap-2 text-sm">
            {slices.map((slice, index) => (
              <li key={slice.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-ink-soft">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SERIES[index % SERIES.length] }} />
                  {slice.name}
                </span>
                <span className="font-mono text-xs text-ink-muted">
                  {formatNumber(slice.value)} · {grandTotal ? Math.round((slice.value / grandTotal) * 100) : 0}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState title="No requests yet" description="Send a request through the gateway to see data here." />
      )}
    </div>
  );
}
