import { ArrowRight, CheckCircle2, MinusCircle, XCircle } from "lucide-react";

const ICONS = { ok: CheckCircle2, fail: XCircle, skip: MinusCircle };
const TONE = { ok: "text-good-ink", fail: "text-bad-ink", skip: "text-ink-muted" };

// A compact checklist of what happened in THIS request (see
// lib/playground/buildFlowSummary.js), plus a link into the full animated
// Request Flow page preselected to the scenario that matches.
export default function FlowSummary({ steps, onViewFullFlow }) {
  if (!steps || steps.length === 0) return null;

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-ink">Request Flow Summary</h3>
        {onViewFullFlow && (
          <button
            type="button"
            onClick={onViewFullFlow}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:text-accent-strong"
          >
            View Full Request Flow
            <ArrowRight size={13} />
          </button>
        )}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {steps.map((item, index) => {
          const Icon = ICONS[item.state];
          return (
            <li key={index} className="flex items-center gap-1.5 text-xs" title={item.detail}>
              <Icon size={14} className={`shrink-0 ${TONE[item.state]}`} />
              <span className="text-ink-soft">{item.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
