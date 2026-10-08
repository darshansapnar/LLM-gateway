import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatTimestamp } from "./formatTimestamp.js";
import { AXIS_TICK_STYLE, CHART_GRID, SERIES, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chartTheme.js";
import { formatUsd } from "../../lib/format.js";
import EmptyState from "../common/EmptyState.jsx";

// Actual cost billed vs cost saved by caching, per time bucket.
export default function CostBarChart({ data }) {
  const chartData = data.map((bucket) => ({
    label: formatTimestamp(bucket.timestamp),
    cost: Number(bucket.costUsd.toFixed(5)),
    saved: Number(bucket.costSavedUsd.toFixed(5)),
  }));

  const hasData = chartData.some((d) => d.cost > 0 || d.saved > 0);

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-medium text-ink">Cost vs. cost saved by caching</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
            <YAxis tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} width={48} tickFormatter={formatUsd} />
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} formatter={(v) => formatUsd(v)} />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-ink-soft)" }} />
            <Bar dataKey="cost" name="Cost" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="saved" name="Saved" fill={SERIES[2]} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState title="No cost data yet" description="Cost and savings will appear here once requests come through." />
      )}
    </div>
  );
}
