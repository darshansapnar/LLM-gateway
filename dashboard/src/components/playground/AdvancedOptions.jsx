import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";

const STATUS_META = {
  enabled: { label: "Semantic cache: enabled for this key", tone: "text-good-ink" },
  disabled: { label: "Semantic cache: disabled for this key", tone: "text-ink-muted" },
  unknown: { label: "Semantic cache: unknown — send a request to detect", tone: "text-ink-muted" },
};

// Stream and bypass are real per-request toggles; semantic caching is
// deliberately NOT one here - it's controlled by the API key and global
// config (see CLAUDE.md's semantic caching section), so this only reports
// its current status (read from the X-Semantic-Cache response header of
// the last request) rather than offering a checkbox that would lie about
// how the setting actually works.
export default function AdvancedOptions({ stream, onChangeStream, bypass, onChangeBypass, semanticCacheStatus }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[semanticCacheStatus] || STATUS_META.unknown;

  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-ink-soft"
      >
        Advanced options
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={stream}
              onChange={(event) => onChangeStream(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-line accent-accent"
            />
            Stream response
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={bypass}
              onChange={(event) => onChangeBypass(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-line accent-accent"
            />
            Bypass cache
          </label>

          <div className="rounded-md bg-surface-2 px-2.5 py-2 text-xs">
            <div className={`font-medium ${meta.tone}`}>{meta.label}</div>
            <div className="mt-1 flex items-start gap-1 text-ink-muted">
              <Info size={11} className="mt-0.5 shrink-0" />
              Semantic caching is controlled by the API key and global config, not per request. Change this in API Keys.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
