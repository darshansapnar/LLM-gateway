const META = {
  CLOSED: { label: "CLOSED", tone: "bg-good-bg text-good-ink" },
  OPEN: { label: "OPEN", tone: "bg-bad-bg text-bad-ink" },
  HALF_OPEN: { label: "HALF-OPEN", tone: "bg-warn-bg text-warn-ink" },
};

// The Groq/Gemini circuit breaker's current state, shown inside the
// provider node. CLOSED = healthy, OPEN = tripped (provider skipped for
// 30s), HALF-OPEN = the one test request that decides whether it recloses.
export default function CircuitBreakerIndicator({ state }) {
  if (!state) return null;
  const meta = META[state] || META.CLOSED;

  return (
    <div className={`mt-1.5 flex items-center justify-between rounded-md border-t border-line pt-1.5 text-[9.5px]`}>
      <span className="text-ink-muted">Circuit breaker</span>
      <span className={`rounded-full px-1.5 py-0.5 font-bold ${meta.tone}`}>{meta.label}</span>
    </div>
  );
}
