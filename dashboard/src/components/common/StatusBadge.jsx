import Badge from "./Badge.jsx";
import { circuitTone } from "../../lib/badgeTone.js";

const LABELS = { CLOSED: "Closed", OPEN: "Open", HALF_OPEN: "Half-open" };

// Circuit breaker state as a pastel pill: green = healthy (CLOSED),
// amber = degraded/recovering (HALF_OPEN), red = tripped (OPEN).
export default function StatusBadge({ state }) {
  return (
    <Badge tone={circuitTone(state)} dot>
      {LABELS[state] || state}
    </Badge>
  );
}
