import { AlertTriangle, RotateCw } from "lucide-react";

// A clear, non-alarming error banner used whenever a page's data fetch
// fails. Always offers a retry, since every fetch on this dashboard is
// just a poll that can simply be run again.
export default function ErrorBanner({ message, onRetry }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-bad-bg bg-bad-bg/40 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-bad-ink">
        <AlertTriangle size={16} className="shrink-0" />
        <span>Couldn't load data: {message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-2"
        >
          <RotateCw size={13} />
          Retry
        </button>
      )}
    </div>
  );
}
