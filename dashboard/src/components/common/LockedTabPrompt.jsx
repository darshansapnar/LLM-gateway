import { Lock, KeyRound } from "lucide-react";
import PageHeader from "../layout/PageHeader.jsx";

export default function LockedTabPrompt({ tabName, onOpenLogin, onOpenMobileNav, onNavigate }) {
  return (
    <section>
      <PageHeader
        title={tabName}
        subtitle="This section requires admin privileges."
        onOpenMobileNav={onOpenMobileNav}
      />

      <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-line bg-surface p-12 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface-2 text-ink-muted">
          <Lock size={26} className="text-accent" />
        </div>

        <h2 className="mt-4 text-base font-semibold text-ink">Admin Sign In Required</h2>
        <p className="mt-1.5 max-w-md text-sm text-ink-muted">
          The <strong>{tabName}</strong> tab contains system configuration, API keys, and raw traffic logs. Sign in with your admin key to unlock full gateway management.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onOpenLogin}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-strong"
          >
            <KeyRound size={16} />
            Admin Sign In
          </button>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("Playground")}
              className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface-2"
            >
              Try Playground
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
