import { useState } from "react";
import { Loader2 } from "lucide-react";
import Modal from "../../components/common/Modal.jsx";
import { patchKey } from "../../api.js";
import { PII_TYPES } from "../../lib/piiTypes.js";

// A small focused dialog (same Modal shell as CreateKeyDialog) for editing
// an EXISTING key's PII settings - piiMode, piiTypes, restoreInResponse -
// all three PATCHed together in one call, since they only make sense as a
// set (no point picking types while piiMode is "off").
export default function EditPiiDialog({ adminKey, apiKey, onClose, onSaved }) {
  const [piiMode, setPiiMode] = useState(apiKey.piiMode);
  const [piiTypes, setPiiTypes] = useState(apiKey.piiTypes ?? PII_TYPES);
  const [restoreInResponse, setRestoreInResponse] = useState(apiKey.restoreInResponse);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function togglePiiType(type) {
    setPiiTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  async function handleSave() {
    if (piiMode !== "off" && piiTypes.length === 0) {
      setError("Pick at least one PII type, or set the mode to Off.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchKey(adminKey, apiKey.id, { piiMode, piiTypes, restoreInResponse });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`PII settings — ${apiKey.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Mode</label>
          <select
            value={piiMode}
            onChange={(event) => setPiiMode(event.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          >
            <option value="mask">Mask - detect and replace, restore for the caller</option>
            <option value="block">Block - reject the request (422) instead of forwarding it</option>
            <option value="off">Off - no detection at all</option>
          </select>
        </div>

        {piiMode !== "off" && (
          <>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink-soft">Types to detect</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {PII_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-1.5 text-xs text-ink">
                    <input
                      type="checkbox"
                      checked={piiTypes.includes(type)}
                      onChange={() => togglePiiType(type)}
                      className="h-3.5 w-3.5 rounded border-line accent-accent"
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={restoreInResponse}
                onChange={(event) => setRestoreInResponse(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-line accent-accent"
              />
              Restore real values in the response
            </label>
          </>
        )}

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
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
