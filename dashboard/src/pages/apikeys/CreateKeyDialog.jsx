import { useState } from "react";
import { Check, Copy, Loader2, PlayCircle } from "lucide-react";
import Modal from "../../components/common/Modal.jsx";
import { createKey } from "../../api.js";

const DEFAULTS = { requestsPerMinute: "20", tokensPerDay: "50000" };

function CopyKeyButton({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard access denied - nothing useful to do about it here.
        }
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-strong"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Two-step dialog: a form, then - once the backend creates the key - the
// raw key shown exactly once. Generation/hashing happens in
// src/services/apiKey.service.js (shared with scripts/createApiKey.js),
// which only ever returns the raw key in that one POST response; nothing
// stores it, so once this dialog closes it's gone from the dashboard too -
// same reason a password hash can't be turned back into a password.
export default function CreateKeyDialog({ adminKey, onClose, onCreated, onUseInPlayground }) {
  const [name, setName] = useState("");
  const [requestsPerMinute, setRequestsPerMinute] = useState(DEFAULTS.requestsPerMinute);
  const [tokensPerDay, setTokensPerDay] = useState(DEFAULTS.tokensPerDay);
  const [semanticCacheEnabled, setSemanticCacheEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const rpm = Number(requestsPerMinute);
    const tpd = Number(tokensPerDay);
    if (!Number.isFinite(rpm) || rpm <= 0) {
      setError("Requests per minute must be a positive number.");
      return;
    }
    if (!Number.isFinite(tpd) || tpd <= 0) {
      setError("Tokens per day must be a positive number.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await createKey(adminKey, { name: name.trim(), requestsPerMinute: rpm, tokensPerDay: tpd, semanticCacheEnabled });
      setCreated(result);
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <Modal title="API key created" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-warn-bg bg-warn-bg/60 px-3 py-2 text-xs font-medium text-warn-ink">
            This key is shown only once. Copy it now - it will not be shown again after you close this dialog.
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-sm text-ink">{created.key}</code>
            <CopyKeyButton value={created.key} />
          </div>

          <dl className="grid grid-cols-3 gap-2 text-xs text-ink-soft">
            <div>
              <dt className="text-ink-muted">Name</dt>
              <dd className="truncate font-medium text-ink">{created.name}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Limits</dt>
              <dd className="font-medium text-ink">
                {created.requestsPerMinute}/min · {created.tokensPerDay}/day
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Semantic cache</dt>
              <dd className="font-medium text-ink">{created.semanticCacheEnabled ? "Enabled" : "Disabled"}</dd>
            </div>
          </dl>

          <div className="mt-1 flex items-center justify-end gap-2">
            {onUseInPlayground && (
              <button
                type="button"
                onClick={() => onUseInPlayground(created.key)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-soft hover:bg-surface-2"
              >
                <PlayCircle size={14} />
                Use in Playground
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-strong"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create API key" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Name</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. my-app-prod"
            autoFocus
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Requests per minute</label>
            <input
              type="number"
              min="1"
              value={requestsPerMinute}
              onChange={(event) => setRequestsPerMinute(event.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Tokens per day</label>
            <input
              type="number"
              min="1"
              value={tokensPerDay}
              onChange={(event) => setTokensPerDay(event.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={semanticCacheEnabled}
            onChange={(event) => setSemanticCacheEnabled(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-line accent-accent"
          />
          Enable semantic cache for this key
        </label>

        {error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-xs text-bad-ink">{error}</p>}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-soft hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 size={13} className="animate-spin" />}
            {submitting ? "Creating…" : "Create key"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
