const TONE_CLASSES = {
  good: "bg-good-bg text-good-ink",
  warn: "bg-warn-bg text-warn-ink",
  bad: "bg-bad-bg text-bad-ink",
  neutral: "bg-neutral-bg text-neutral-ink",
  accent: "bg-accent-soft text-accent-soft-ink",
};

const DOT_CLASSES = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  neutral: "bg-ink-muted",
  accent: "bg-accent",
};

// A soft pastel pill used everywhere a small categorical/status label is
// needed: circuit breaker state, request status, cache type, provider name.
export default function Badge({ tone = "neutral", dot = false, className = "", children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[tone]}`} />}
      {children}
    </span>
  );
}
