// One permanent background connector in the diagram's fixed topology.
// Idle = subdued line color. Once traveled, it stays lit in the resolved
// outcome color for the rest of the run (the persistent "trail" showing
// everywhere this request has been). `isActive` adds a soft glow while the
// packet is currently on this exact connection.
export default function FlowConnection({ d, state, isActive }) {
  const color = state?.done ? state.color : "var(--color-line)";

  return (
    <g>
      {isActive && <path d={d} fill="none" stroke={color} strokeWidth={10} opacity={0.18} strokeLinecap="round" />}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={state?.done ? 2.5 : 2}
        opacity={state?.done ? 0.9 : 0.55}
        strokeLinecap="round"
        style={{ transition: "stroke 300ms ease, opacity 300ms ease" }}
      />
    </g>
  );
}
