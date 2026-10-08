import { ArrowDown, ArrowUp } from "lucide-react";

// A single KPI tile: icon, big mono-font number, label, optional secondary
// line, and an optional change-vs-previous-period indicator. `change` is
// only rendered when the caller actually has a comparable previous value -
// see pages/Overview.jsx for why that's not always available today.
export default function KpiCard({ icon: Icon, label, value, secondary, change }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {Icon && <Icon size={15} className="text-accent" strokeWidth={2} />}
      </div>

      <div className="mt-2 font-mono text-[1.6rem] font-semibold leading-none text-ink">{value}</div>

      {(secondary || change) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {change && (
            <span
              className={`inline-flex items-center gap-0.5 font-medium ${
                change.direction === "up" ? "text-good-ink" : "text-bad-ink"
              }`}
            >
              {change.direction === "up" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {change.label}
            </span>
          )}
          {secondary && <span className="text-ink-muted">{secondary}</span>}
        </div>
      )}
    </div>
  );
}
