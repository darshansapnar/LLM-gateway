// A thin usage/progress meter - same track-and-fill shape used for API key
// rate-limit usage and provider success-rate bars. `ratio` is 0-1; the fill
// tone shifts from accent -> warn -> bad as usage approaches the limit.
export default function ProgressBar({ ratio, label, tone }) {
  const clamped = Math.min(1, Math.max(0, ratio || 0));
  const autoTone = clamped > 0.9 ? "bad" : clamped > 0.7 ? "warn" : "accent";
  const fillClass = { accent: "bg-accent", warn: "bg-warn", bad: "bg-bad", good: "bg-good" }[tone || autoTone];

  return (
    <div className="w-full">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${clamped * 100}%` }} />
      </div>
      {label && <div className="mt-1 text-xs text-ink-muted">{label}</div>}
    </div>
  );
}
