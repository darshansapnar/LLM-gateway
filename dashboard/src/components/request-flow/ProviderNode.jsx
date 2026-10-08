import FlowNode from "./FlowNode.jsx";
import CircuitBreakerIndicator from "./CircuitBreakerIndicator.jsx";

// Groq / Gemini: a FlowNode plus its circuit breaker state. Greyed out via
// FlowNode's own "skipped" styling when the breaker is OPEN and the router
// routes around it entirely.
export default function ProviderNode({ x, y, icon, label, caption, state }) {
  const circuitState = state?.circuitState;
  const effectiveState = circuitState === "OPEN" && state.status === "idle" ? { ...state, status: "skipped" } : state;

  return (
    <FlowNode x={x} y={y} icon={icon} label={label} caption={caption} state={effectiveState}>
      <CircuitBreakerIndicator state={circuitState} />
    </FlowNode>
  );
}
