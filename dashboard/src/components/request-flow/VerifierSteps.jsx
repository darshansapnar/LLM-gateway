import { VERIFIER_SUBSTEPS } from "../../lib/request-flow/nodes.js";

const DOT = {
  idle: "bg-line",
  active: "bg-accent animate-pulse",
  success: "bg-good",
  error: "bg-bad",
  skipped: "bg-ink-muted",
};

// The semantic-cache verifier pipeline, rendered as a compact mini-stepper
// inside the Semantic Cache node: Generate Embedding → Redis Vector Search
// → Similarity Check → Antonym Guard → Entity Check → LLM Judge. The main
// request packet "parks" at the Semantic Cache node while this advances -
// it isn't a separate stop on the main diagram.
export default function VerifierSteps({ subStepStates }) {
  const hasAny = Object.keys(subStepStates).length > 0;
  if (!hasAny) return null;

  return (
    <ol className="mt-1.5 space-y-1 border-t border-line pt-1.5">
      {VERIFIER_SUBSTEPS.map(({ id, label }) => {
        const sub = subStepStates[id];
        const status = sub?.status ?? "idle";
        const note = sub?.detail?.lines?.[0];
        return (
          <li key={id} className="flex items-start gap-1.5">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[status]}`} />
            <div className="min-w-0 flex-1">
              <div className={`truncate text-[10px] leading-tight ${status === "idle" ? "text-ink-muted" : "text-ink-soft"}`}>
                {label}
              </div>
              {note && status !== "idle" && <div className="truncate text-[9.5px] leading-tight text-ink-muted">{note}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
