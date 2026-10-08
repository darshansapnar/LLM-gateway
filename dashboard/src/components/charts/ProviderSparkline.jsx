import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";

// A tiny, axis-free trend line of a provider's last few request latencies
// (derived from recent /v1/admin/logs entries - see pages/ProvidersPage.jsx).
// Too few points to mean much statistically; it's a glanceable trend, not a
// chart meant to be read precisely (no tooltip/legend needed at this size).
export default function ProviderSparkline({ points }) {
  if (!points || points.length < 2) {
    return <div className="flex h-10 w-24 items-center text-xs text-ink-muted">Not enough data</div>;
  }

  return (
    <div className="h-10 w-24">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points.map((latencyMs, i) => ({ i, latencyMs }))}>
          <YAxis hide domain={["dataMin - 50", "dataMax + 50"]} />
          <Line type="monotone" dataKey="latencyMs" stroke="var(--color-series-1)" strokeWidth={1.75} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
