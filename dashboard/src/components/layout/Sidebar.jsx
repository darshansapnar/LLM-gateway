import { useEffect, useState } from "react";
import { LayoutDashboard, ListTree, Server, Database, KeyRound, Workflow, FlaskConical, Moon, Sun, X, LogOut, Lock } from "lucide-react";
import { getHealth } from "../../api.js";

const NAV_ITEMS = [
  { id: "Overview", label: "Overview", icon: LayoutDashboard },
  { id: "Requests", label: "Requests", icon: ListTree },
  { id: "Providers", label: "Providers", icon: Server },
  { id: "Cache", label: "Cache", icon: Database },
  { id: "API Keys", label: "API Keys", icon: KeyRound },
  { id: "Request Flow", label: "Request Flow", icon: Workflow },
  { id: "Playground", label: "Playground", icon: FlaskConical },
];

// Polls the public, unauthenticated GET /health endpoint (no admin key
// needed) just to drive the little connection dot - independent of
// whether any particular page's admin data happens to be loading.
function useConnectionStatus() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        await getHealth();
        if (!cancelled) setStatus("ok");
      } catch {
        if (!cancelled) setStatus("down");
      }
    }

    check();
    const interval = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}

const CONNECTION_STYLES = {
  checking: { className: "bg-warn", label: "Checking connection…" },
  ok: { className: "bg-good", label: "Connected to gateway" },
  down: { className: "bg-bad", label: "Can't reach gateway" },
};

const LOCKED_WITHOUT_ADMIN = new Set(["Requests", "Providers", "Cache", "API Keys"]);

function NavList({ activeTab, onSelect, adminKey }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
        const active = id === activeTab;
        const isLocked = !adminKey && LOCKED_WITHOUT_ADMIN.has(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={
              active
                ? "flex items-center justify-between rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent-soft-ink"
                : "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-2"
            }
          >
            <div className="flex items-center gap-2.5">
              <Icon size={17} strokeWidth={active ? 2.25 : 2} />
              {label}
            </div>
            {isLocked && <Lock size={13} className="text-ink-muted" />}
          </button>
        );
      })}
    </nav>
  );
}

// The left sidebar: logo, nav, connection dot, theme toggle, log out / admin login.
// Renders as a fixed column on md+ screens and as a slide-over drawer
// (controlled by `mobileOpen`/`onCloseMobile`) on small screens.
export default function Sidebar({
  adminKey,
  onOpenLogin,
  activeTab,
  onSelect,
  theme,
  onToggleTheme,
  onLogout,
  mobileOpen,
  onCloseMobile,
}) {
  const connection = useConnectionStatus();
  const connectionStyle = CONNECTION_STYLES[connection];

  const body = (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-white">
            LG
          </div>
          <span className="text-sm font-semibold text-ink">LLM Gateway</span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="rounded-md p-1 text-ink-muted hover:bg-surface-2 md:hidden"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
      </div>

      <NavList
        adminKey={adminKey}
        activeTab={activeTab}
        onSelect={(id) => {
          onSelect(id);
          onCloseMobile?.();
        }}
      />

      <div className="mt-auto flex flex-col gap-3 border-t border-line px-4 py-4">
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connectionStyle.className}`} />
            {connectionStyle.label}
          </div>
          {!adminKey ? (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">Demo</span>
          ) : (
            <span className="rounded bg-good/15 px-1.5 py-0.5 text-[10px] font-semibold text-good">Admin</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-2"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {adminKey ? (
            <button
              type="button"
              onClick={onLogout}
              title="Sign out of admin mode"
              className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-soft hover:bg-surface-2"
            >
              <LogOut size={14} />
              <span>Log out</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              title="Admin sign in"
              className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong"
            >
              <KeyRound size={14} />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Fixed sidebar on medium+ screens */}
      <aside className="hidden w-60 shrink-0 border-r border-line md:block">{body}</aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={onCloseMobile} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line shadow-lg">{body}</aside>
        </div>
      )}
    </>
  );
}
