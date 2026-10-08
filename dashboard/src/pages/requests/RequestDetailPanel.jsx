import { useEffect } from "react";
import { X, CheckCircle2, XCircle } from "lucide-react";
import Badge from "../../components/common/Badge.jsx";
import { formatDateTime, formatLatency, formatNumber, formatUsd } from "../../lib/format.js";
import { cacheTypeTone, requestStatusTone } from "../../lib/badgeTone.js";

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

// A slide-over panel (not a centered modal) showing everything RequestLog
// recorded for one request: full prompt/response, cache + verifier info,
// the fallback-attempt timeline, and any error. Closes on backdrop click,
// the X button, or Escape.
export default function RequestDetailPanel({ log, onClose }) {
  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />

      <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-line bg-surface shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h3 className="text-sm font-semibold text-ink">Request details</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-muted hover:bg-surface-2" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={requestStatusTone(log.status)} dot>
              {log.status}
            </Badge>
            <Badge tone={cacheTypeTone(log.cacheType)}>{log.cacheType} cache</Badge>
            {log.fallbackUsed && <Badge tone="warn">fallback used</Badge>}
          </div>

          <dl className="grid grid-cols-2 gap-4">
            <Field label="Time">{formatDateTime(log.createdAt)}</Field>
            <Field label="Provider / model">
              {log.provider} / {log.model}
            </Field>
            <Field label="Latency">
              {formatLatency(log.latencyMs)}
              {log.ttftMs != null ? ` (TTFT ${formatLatency(log.ttftMs)})` : ""}
            </Field>
            <Field label="Tokens">
              {formatNumber(log.inputTokens)} in / {formatNumber(log.outputTokens)} out
            </Field>
            <Field label="Cost">
              {formatUsd(log.costUsd)}
              {log.costSavedUsd ? ` (saved ${formatUsd(log.costSavedUsd)})` : ""}
            </Field>
            {log.similarity != null && <Field label="Similarity">{log.similarity.toFixed(4)}</Field>}
          </dl>

          {log.matchedPrompt && <Field label="Matched prompt">{log.matchedPrompt}</Field>}
          {log.verifierResult && <Field label="Verifier result">{log.verifierResult}</Field>}

          <div>
            <h4 className="text-xs font-semibold text-ink-soft">Prompt</h4>
            <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-ink-soft">
              {log.prompt}
            </pre>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-ink-soft">Response</h4>
            <pre className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs text-ink-soft">
              {log.response || "(none)"}
            </pre>
          </div>

          {log.attempts?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-ink-soft">Attempts</h4>
              <ul className="mt-2 flex flex-col gap-2">
                {log.attempts.map((attempt, index) => (
                  <li key={index} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-xs">
                    {attempt.success ? (
                      <CheckCircle2 size={15} className="shrink-0 text-good" />
                    ) : (
                      <XCircle size={15} className="shrink-0 text-bad" />
                    )}
                    <span className="font-medium text-ink">{attempt.provider}</span>
                    <span className="font-mono text-ink-muted">{formatLatency(attempt.latencyMs)}</span>
                    {attempt.error && <span className="truncate text-bad-ink">{attempt.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {log.errorMessage && (
            <div>
              <h4 className="text-xs font-semibold text-bad-ink">Error</h4>
              <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-lg border border-bad-bg bg-bad-bg/40 p-3 font-mono text-xs text-bad-ink">
                {log.errorMessage}
              </pre>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
