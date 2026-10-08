const RANGES = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

// Segmented control for the admin endpoints' ?range= filter. Purely
// presentational - the parent page owns the actual range state.
export default function RangeSelector({ range, onChange }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {RANGES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={
            value === range
              ? "rounded-md bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-sm"
              : "rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink-soft"
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
