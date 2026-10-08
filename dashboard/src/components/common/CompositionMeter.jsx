// A single stacked proportion bar for part-to-whole breakdowns with very
// few categories (e.g. exact/semantic/miss) - preferred over a donut for
// this kind of simple three-way split, with a legend underneath carrying
// the exact counts since color alone never carries the value.
const TONE_FILL = { good: "bg-good", accent: "bg-accent", neutral: "bg-ink-muted", warn: "bg-warn", bad: "bg-bad" };

export default function CompositionMeter({ segments }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {segments.map((segment) =>
          segment.value > 0 ? (
            <div
              key={segment.label}
              className={TONE_FILL[segment.tone]}
              style={{ width: `${total ? (segment.value / total) * 100 : 0}%` }}
              title={`${segment.label}: ${segment.value}`}
            />
          ) : null
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${TONE_FILL[segment.tone]}`} />
            {segment.label} · {total ? Math.round((segment.value / total) * 100) : 0}%
          </span>
        ))}
      </div>
    </div>
  );
}
