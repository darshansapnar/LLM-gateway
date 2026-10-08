// Resolves a scenario step's { from, to, via } into an actual SVG path -
// either a segment of the fixed forward topology (walked forward or
// backward, for retry/fallback bounces) or a generated return-lane trip.
import { CONNECTIONS_BY_ID, returnPathFrom } from "./nodes.js";

// Returns { d, reverse, connectionId }. `reverse: true` means the packet
// should travel the path from its end to its start (used for a retry/
// fallback bounce back from a provider to the router - same geometry as
// the forward router->provider connection, just walked backwards).
export function resolveStepPath(step) {
  if (step.via === "return") {
    return { d: returnPathFrom(step.from), reverse: false, connectionId: null };
  }

  const forwardId = `${step.from}-${step.to}`;
  if (CONNECTIONS_BY_ID[forwardId]) {
    return { d: CONNECTIONS_BY_ID[forwardId].d, reverse: false, connectionId: forwardId };
  }

  const backwardId = `${step.to}-${step.from}`;
  if (CONNECTIONS_BY_ID[backwardId]) {
    return { d: CONNECTIONS_BY_ID[backwardId].d, reverse: true, connectionId: backwardId };
  }

  throw new Error(`request-flow: no connection between "${step.from}" and "${step.to}"`);
}
