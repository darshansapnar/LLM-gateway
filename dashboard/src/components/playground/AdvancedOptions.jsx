import { useState } from "react";
import { ChevronDown, Info, Settings2 } from "lucide-react";

const STATUS_META = {
  enabled: { label: "Semantic cache: enabled for this key", tone: "text-good-ink" },
  disabled: { label: "Semantic cache: disabled for this key", tone: "text-ink-muted" },
  unknown: { label: "Semantic cache: unknown — send a request to detect", tone: "text-ink-muted" },
};

// Mirrors STATUS_META above - "off"/"mask"/"block" read straight from the
// X-PII-Mode response header (see piiModeHeaderValue() in chat.routes.js).
const PII_STATUS_META = {
  mask: { label: "PII redaction: mask — sensitive values detected & replaced", tone: "text-good-ink" },
  block: { label: "PII redaction: block — sensitive prompts are rejected (422)", tone: "text-accent" },
  off: { label: "PII redaction: off for this key", tone: "text-ink-muted" },
  unknown: { label: "PII redaction: unknown — send a request to detect", tone: "text-ink-muted" },
};

// Stream and bypass are real per-request toggles; semantic caching and PII
// redaction are deliberately NOT ones here - both are controlled by the API
// key (and, for semantic caching, global config too - see CLAUDE.md), so
// this only reports their current status (read from the X-Semantic-Cache /
// X-PII-Mode response headers of the last request) rather than offering
// checkboxes that would lie about how the settings actually work. The "Edit
// in API Keys" button is the actual way to change either one.
export default function AdvancedOptions({
  stream,
  onChangeStream,
  bypass,
  onChangeBypass,
  semanticCacheStatus,
  piiModeStatus,
  onEditPiiSettings,
}) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[semanticCacheStatus] || STATUS_META.unknown;
  const piiMeta = PII_STATUS_META[piiModeStatus] || PII_STATUS_META.unknown;

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

          <div className="rounded-md bg-surface-2 px-2.5 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className={`font-medium ${piiMeta.tone}`}>{piiMeta.label}</div>
              {onEditPiiSettings && (
                <button
                  type="button"
                  onClick={onEditPiiSettings}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2"
                >
                  <Settings2 size={11} />
                  Edit in API Keys
                </button>
              )}
            </div>
            <div className="mt-1 flex items-start gap-1 text-ink-muted">
              <Info size={11} className="mt-0.5 shrink-0" />
              PII redaction is controlled by the API key, not per request.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
