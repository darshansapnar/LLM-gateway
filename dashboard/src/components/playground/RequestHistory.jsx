import { History, RotateCcw, Trash2 } from "lucide-react";
import Badge from "../common/Badge.jsx";
import EmptyState from "../common/EmptyState.jsx";
import { formatLatency, formatRelativeTime } from "../../lib/format.js";

// In-memory only (per the task - no backend endpoint for this). Clicking a
// row restores that exact request/response for inspection; "Re-send"
// replays the exact request that was sent, not whatever's in the editor now.
export default function RequestHistory({ history, onSelect, onResend, onClear }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">Request History</h3>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-bad-ink"
          >
            <Trash2 size={12} />
            Clear history
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <EmptyState icon={History} title="No requests yet" description="Sent requests show up here for quick re-inspection." />
      ) : (
        <ul className="divide-y divide-line">
          {history.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2.5 text-xs">
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="min-w-0 flex-1 truncate text-left text-ink-soft hover:text-ink"
                title={item.prompt}
              >
                {item.prompt}
              </button>
              <span className="hidden shrink-0 text-ink-muted sm:inline">{formatRelativeTime(item.time)}</span>
              <Badge tone={item.statusTone}>{item.status}</Badge>
              {item.provider && <Badge tone="neutral">{item.provider}</Badge>}
              {item.cacheLabel && <Badge tone={item.cacheTone}>{item.cacheLabel}</Badge>}
              <span className="hidden w-14 shrink-0 text-right font-mono text-ink-muted sm:inline">
                {formatLatency(item.latencyMs)}
              </span>
              <button
                type="button"
                onClick={() => onResend(item)}
                title="Re-send"
                className="shrink-0 rounded p-1 text-ink-muted hover:bg-surface-2 hover:text-accent"
              >
                <RotateCcw size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
