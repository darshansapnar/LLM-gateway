import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";

// The gateway API key - kept in whatever state the parent gives it
// (Playground.jsx uses useRememberedApiKey, which defaults to in-memory
// only) and masked by default. Sent as "Authorization: Bearer <key>".
// Never a provider key or the admin key - this field only ever holds the
// per-caller gateway key a developer is testing with.
export default function AuthSection({ apiKey, onChangeApiKey, remember, onChangeRemember }) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
        <KeyRound size={13} />
        Gateway API Key
      </label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={apiKey}
          onChange={(event) => onChangeApiKey(event.target.value)}
          placeholder="gw_..."
          spellCheck={false}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 pr-10 font-mono text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent-soft"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:bg-surface-2"
          aria-label={visible ? "Hide key" : "Show key"}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => onChangeRemember(event.target.checked)}
          className="h-3.5 w-3.5 rounded border-line accent-accent"
        />
        Remember key on this device
      </label>

      <p className="mt-1 text-[11px] text-ink-muted">
        {remember
          ? "Stored in this browser's session storage - survives a refresh, cleared when this tab closes."
          : "Kept in memory for this session only - never saved to disk."}
      </p>
    </div>
  );
}
