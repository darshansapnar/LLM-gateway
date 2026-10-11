import { ShieldAlert, ShieldCheck } from "lucide-react";

// Tells the PII story for this response: either it was BLOCKED outright
// (piiMode "block", 422 before any provider/cache call), or some number of
// sensitive values were masked before the prompt left the gateway - in
// which case `maskedPrompt` (the backend's own field, never reconstructed
// client-side) shows exactly what the provider actually saw.
export default function PiiBanner({ status, piiTypes, piiRedacted, maskedPrompt }) {
  if (status === 422 && Array.isArray(piiTypes)) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-bad-bg bg-bad-bg/40 px-3.5 py-3 text-sm text-bad-ink">
        <ShieldAlert size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">
            Blocked — prompt contains sensitive data{piiTypes.length ? ` (${piiTypes.join(", ")})` : ""}.
          </div>
          <div className="mt-0.5 text-xs opacity-80">
            This key's PII mode is "block" - the request never reached a provider or either cache.
          </div>
        </div>
      </div>
    );
  }

  if (!piiRedacted) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-accent-soft bg-accent-soft px-3.5 py-3 text-sm text-accent-soft-ink">
      <ShieldCheck size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">
          {piiRedacted} sensitive value{piiRedacted === 1 ? "" : "s"} redacted
          {piiTypes?.length ? ` (${piiTypes.join(", ")})` : ""}.
        </div>
        {maskedPrompt && (
          <div className="mt-2">
            <div className="text-xs font-semibold opacity-80">Sent to provider</div>
            <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-2 font-mono text-xs text-ink-soft">
              {maskedPrompt}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
