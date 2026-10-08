import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatTimestamp } from "./formatTimestamp.js";
import { AXIS_TICK_STYLE, CHART_GRID, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE } from "../../lib/chartTheme.js";
import EmptyState from "../common/EmptyState.jsx";

// Requests per time bucket, split into successes vs errors. This is
// literally a success/failure split, so (unlike the other charts) it uses
// the fixed good/bad status colors rather than the categorical series set.
export default function RequestsAreaChart({ data }) {
  const chartData = data.map((bucket) => ({
    label: formatTimestamp(bucket.timestamp),
    successes: bucket.requests - bucket.errors,
    errors: bucket.errors,
  }));

  const hasData = chartData.some((d) => d.successes > 0 || d.errors > 0);

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-medium text-ink">Requests over time</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 12, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
            <YAxis tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-ink-soft)" }} />
            <Area
              type="monotone"
              dataKey="successes"
              name="Successes"
              stroke="var(--color-good)"
              fill="var(--color-good)"
              fillOpacity={0.16}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="errors"
              name="Errors"
              stroke="var(--color-bad)"
              fill="var(--color-bad)"
              fillOpacity={0.16}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState title="No requests yet" description="Send a request through the gateway to see traffic here." />
      )}
    </div>
  );
}
