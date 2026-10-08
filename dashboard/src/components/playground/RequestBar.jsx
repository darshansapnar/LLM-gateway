import { Play, RotateCcw, Square } from "lucide-react";

// The top bar: method badge, editable endpoint, Send/Stop (mutually
// exclusive depending on whether a request is in flight), and Reset.
export default function RequestBar({ endpoint, onChangeEndpoint, onSend, onStop, onReset, isSending }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
      <span className="rounded-md bg-accent-soft px-2.5 py-2 text-xs font-bold tracking-wide text-accent-soft-ink">POST</span>
      <input
        value={endpoint}
        onChange={(event) => onChangeEndpoint(event.target.value)}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent"
      />

      {isSending ? (
        <button
          type="button"
          onClick={onStop}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bad px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Square size={13} fill="currentColor" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onSend}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-white hover:bg-accent-strong"
        >
          <Play size={13} fill="currentColor" />
          Send Request
        </button>
      )}

      <button
        type="button"
        onClick={onReset}
        disabled={isSending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <RotateCcw size={13} />
        Reset
      </button>
    </div>
  );
}
