import { useState } from "react";
import { KeyRound } from "lucide-react";
import { verifyAdminKey } from "../api.js";

// Asks for the admin key and keeps it ONLY in component state (in memory) -
// never localStorage/sessionStorage, so it's gone the moment the tab closes
// or the page reloads. Verifies the key actually works (one real API call)
// before "logging in", so a typo shows an error here instead of every page
// silently failing with a 401.
export default function Login({ onLogin }) {
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await verifyAdminKey(input);
      onLogin(input);
    } catch (err) {
      setError("That admin key didn't work: " + err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-8 shadow-sm"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <KeyRound size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-ink">LLM Gateway</h1>
            <p className="text-sm text-ink-muted">Sign in with your admin key</p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-key" className="text-xs font-medium text-ink-soft">
            Admin key
          </label>
          <input
            id="admin-key"
            type="password"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste your ADMIN_API_KEY"
            autoFocus
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </div>

        {error && <p className="rounded-lg bg-bad-bg px-3 py-2 text-xs text-bad-ink">{error}</p>}

        <button
          type="submit"
          disabled={checking || !input}
          className="mt-1 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? "Checking…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
