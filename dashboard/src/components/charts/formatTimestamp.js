// Shared by all three timeseries charts - turns a bucket's ISO timestamp
// into a short, readable x-axis label.
export function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
