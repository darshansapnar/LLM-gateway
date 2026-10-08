import { Menu, RotateCw } from "lucide-react";
import RangeSelector from "../common/RangeSelector.jsx";
import { formatRelativeTime } from "../../lib/format.js";

// The top bar every page renders: a title, an optional time-range control,
// a "last updated" timestamp, a manual refresh button, and (on small
// screens) the hamburger that opens the sidebar drawer.
export default function PageHeader({ title, subtitle, range, onRangeChange, lastUpdated, onRefresh, onOpenMobileNav, right }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="rounded-md p-1.5 text-ink-soft hover:bg-surface-2 md:hidden"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {lastUpdated && (
          <span className="hidden text-xs text-ink-muted sm:inline">Updated {formatRelativeTime(lastUpdated)}</span>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh now"
            className="rounded-lg border border-line bg-surface p-2 text-ink-soft hover:bg-surface-2"
          >
            <RotateCw size={14} />
          </button>
        )}
        {range !== undefined && <RangeSelector range={range} onChange={onRangeChange} />}
        {right}
      </div>
    </div>
  );
}
