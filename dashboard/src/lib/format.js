// Shared number/time formatting so every page renders values the same way
// (1.2k, $0.0034, 1.4s, "3m ago") instead of each component rolling its own.

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return compactNumberFormatter.format(value);
}

export function formatPercent(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

// Small dollar amounts (cache savings, per-request cost) need more decimal
// places than a normal currency formatter gives - $0.0034 would round to $0.00.
export function formatUsd(value) {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

export function formatLatency(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const RELATIVE_UNITS = [
  { limit: 60, divisor: 1, suffix: "s" },
  { limit: 3600, divisor: 60, suffix: "m" },
  { limit: 86400, divisor: 3600, suffix: "h" },
  { limit: 2592000, divisor: 86400, suffix: "d" },
];

export function formatRelativeTime(date) {
  const then = date instanceof Date ? date : new Date(date);
  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (seconds < 5) return "just now";
  for (const unit of RELATIVE_UNITS) {
    if (seconds < unit.limit) return `${Math.floor(seconds / unit.divisor)}${unit.suffix} ago`;
  }
  return then.toLocaleDateString();
}

export function formatDateTime(date) {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
