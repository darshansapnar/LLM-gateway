const STATUS_META = {
  idle: { label: null, dot: "bg-ink-muted", ring: "border-line", text: "text-ink-muted" },
  active: { label: "Processing", dot: "bg-accent", ring: "border-accent", text: "text-accent" },
  success: { label: "Success", dot: "bg-good", ring: "border-good", text: "text-good-ink" },
  error: { label: "Error", dot: "bg-bad", ring: "border-bad", text: "text-bad-ink" },
  skipped: { label: "Skipped", dot: "bg-ink-muted", ring: "border-line", text: "text-ink-muted" },
  hit: { label: "HIT", dot: "bg-good", ring: "border-good", text: "text-good-ink" },
  miss: { label: "MISS", dot: "bg-ink-muted", ring: "border-line", text: "text-ink-soft" },
};

// One node card in the Request Flow diagram, absolutely positioned by the
// parent (FlowCanvas) using percentages that line up with the SVG
// viewBox underneath it. Purely presentational - all state comes from
// useFlowSimulation via props.
export default function FlowNode({ x, y, width = 168, icon: Icon, label, caption, state, children }) {
  const { status = "idle", detail, activeKey = 0, durationMs = 450 } = state || {};
  const meta = STATUS_META[status] || STATUS_META.idle;
  const isActive = status === "active";
  const isError = status === "error";
  const isSkipped = status === "skipped";

  return (
    <div
      className="absolute"
      style={{ left: `${x}px`, top: `${y}px`, width, transform: "translate(-50%, -50%)" }}
    >
      <div
        key={activeKey}
        className={`relative overflow-hidden rounded-xl border bg-surface px-3 py-2.5 shadow-sm transition-colors duration-300 ${meta.ring} ${
          isSkipped ? "opacity-55" : ""
        } ${isActive ? "flow-node-pulse" : ""} ${isError ? "flow-node-shake" : ""}`}
      >
        {/* Progress indicator for the duration of this step - a filling
            bar rather than a ring, since these cards are rectangular. */}
        {isActive && (
          <div className="absolute inset-x-0 top-0 h-0.5 bg-accent-soft">
            <div className="flow-node-progress h-full bg-accent" style={{ animationDuration: `${durationMs}ms` }} />
          </div>
        )}

        <div className="flex items-center gap-2">
          {Icon && (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-2 ${meta.text}`}>
              <Icon size={13} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-ink">{label}</div>
            {caption && <div className="truncate text-[10.5px] text-ink-muted">{caption}</div>}
          </div>
          {meta.label && (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${meta.text}`}>
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
          )}
        </div>

        {detail?.lines?.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
            {detail.lines.map((line, i) => (
              <li key={i} className="truncate text-[10px] leading-tight text-ink-soft">
                {line}
              </li>
            ))}
          </ul>
        )}

        {children}
      </div>

      {isError && detail?.lines?.length > 0 && (
        <div className="absolute left-1/2 top-full z-10 mt-1.5 w-48 -translate-x-1/2 rounded-lg border border-bad-bg bg-surface p-2 text-[10px] text-bad-ink shadow-md">
          {detail.lines[detail.lines.length - 1]}
        </div>
      )}
    </div>
  );
}
