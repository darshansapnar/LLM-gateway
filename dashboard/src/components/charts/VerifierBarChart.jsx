import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, CartesianGrid, LabelList } from "recharts";
import { AXIS_TICK_STYLE, CHART_GRID, SERIES, TOOLTIP_CONTENT_STYLE } from "../../lib/chartTheme.js";
import { formatNumber } from "../../lib/format.js";
import EmptyState from "../common/EmptyState.jsx";

// How semantic cache candidates were actually resolved. These are four
// distinct outcomes (not a good/bad pair - a "rejected" is often the
// verifier correctly avoiding a wrong cache hit), so each gets its own
// categorical color rather than a status color.
export default function VerifierBarChart({ verifier }) {
  const data = [
    { name: "Accepted (high similarity)", value: verifier.acceptedHighSimilarity },
    { name: "Accepted (by judge)", value: verifier.acceptedByJudge },
    { name: "Rejected (by guard)", value: verifier.rejectedByGuard },
    { name: "Rejected (by judge)", value: verifier.rejectedByJudge },
  ];

  const hasData = data.some((d) => d.value > 0);

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-medium text-ink">Verifier outcomes</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={{ stroke: CHART_GRID }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} width={160} />
            <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} formatter={(v) => [`${formatNumber(v)}`, "Candidates"]} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.map((_, index) => (
                <Cell key={index} fill={SERIES[index % SERIES.length]} />
              ))}
              <LabelList dataKey="value" position="right" style={{ fill: "var(--color-ink-soft)", fontSize: 12 }} formatter={formatNumber} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState title="No semantic candidates yet" description="Verifier decisions will show up here once semantic caching is in use." />
      )}
    </div>
  );
}
