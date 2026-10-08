import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { usePolling } from "../hooks/usePolling.js";
import { getKeys, patchKey, deleteKey } from "../api.js";
import PageHeader from "../components/layout/PageHeader.jsx";
import ErrorBanner from "../components/common/ErrorBanner.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import ProgressBar from "../components/common/ProgressBar.jsx";
import { SkeletonTableRows } from "../components/common/Skeleton.jsx";
import CreateKeyDialog from "./apikeys/CreateKeyDialog.jsx";
import { formatNumber } from "../lib/format.js";

function ToggleButton({ on, disabled, onClick, onLabel, offLabel }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        on
          ? "rounded-full bg-good-bg px-2.5 py-1 text-xs font-semibold text-good-ink disabled:cursor-wait disabled:opacity-60"
          : "rounded-full bg-neutral-bg px-2.5 py-1 text-xs font-semibold text-neutral-ink disabled:cursor-wait disabled:opacity-60"
      }
    >
      {on ? onLabel : offLabel}
    </button>
  );
}

// Every API key with its limits, today's usage, and two toggle buttons
// (active / semantic caching) that PATCH the backend and then reload, plus
// "Create API key" (opens CreateKeyDialog.jsx) and a per-row delete action.
//
// Note: the requests/min limit has no live progress bar here - the API
// only reports `requestsToday` (a daily total), not a current per-minute
// count, so a bar against a per-minute cap would be misleading. Tokens/day
// does get a real bar since both sides of that ratio exist. A live
// requests/min bar would need `/v1/admin/keys` to expose something like
// `requestsThisMinute` from the same Redis counter rateLimit.js already
// uses to enforce the limit.
export default function ApiKeysPage({ adminKey, onOpenMobileNav, onUseKeyInPlayground }) {
  const { data, loading, error, lastUpdated, reload } = usePolling(() => getKeys(adminKey), [adminKey]);
  const [pending, setPending] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  async function toggle(key, field) {
    setPending(key.id);
    try {
      await patchKey(adminKey, key.id, { [field]: !key[field] });
      await reload();
    } catch (err) {
      alert("Failed to update key: " + err.message);
    } finally {
      setPending(null);
    }
  }

  async function handleDelete(key) {
    if (!window.confirm(`Delete API key "${key.name}"? This can't be undone - callers using it will get 401s immediately.`)) {
      return;
    }
    setPending(key.id);
    try {
      await deleteKey(adminKey, key.id);
      await reload();
    } catch (err) {
      alert("Failed to delete key: " + err.message);
    } finally {
      setPending(null);
    }
  }

  return (
    <section>
      <PageHeader
        title="API Keys"
        lastUpdated={lastUpdated}
        onRefresh={reload}
        onOpenMobileNav={onOpenMobileNav}
        right={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-strong"
          >
            <Plus size={14} />
            Create API key
          </button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {!error && (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  {["Name", "Prefix", "Limits", "Usage", "Active", "Semantic cache", ""].map((col) => (
                    <th key={col} className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-ink-soft">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {loading ? (
                  <SkeletonTableRows rows={4} cols={7} />
                ) : (
                  data?.map((key) => (
                    <tr key={key.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{key.name}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink-soft">{key.keyPrefix}…</code>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">
                        {formatNumber(key.requestsPerMinute)}/min · {formatNumber(key.tokensPerDay)}/day
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-40">
                          <ProgressBar
                            ratio={key.tokensPerDay ? key.tokensToday / key.tokensPerDay : 0}
                            label={`${formatNumber(key.tokensToday)} / ${formatNumber(key.tokensPerDay)} tokens today`}
                          />
                          <div className="mt-1.5 text-xs text-ink-muted">{formatNumber(key.requestsToday)} requests today</div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <ToggleButton
                          on={key.isActive}
                          disabled={pending === key.id}
                          onClick={() => toggle(key, "isActive")}
                          onLabel="Active"
                          offLabel="Inactive"
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <ToggleButton
                          on={key.semanticCacheEnabled}
                          disabled={pending === key.id}
                          onClick={() => toggle(key, "semanticCacheEnabled")}
                          onLabel="On"
                          offLabel="Off"
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={pending === key.id}
                          onClick={() => handleDelete(key)}
                          title="Delete key"
                          className="rounded-md p-1.5 text-ink-muted hover:bg-bad-bg hover:text-bad-ink disabled:cursor-wait disabled:opacity-60"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && data?.length === 0 && (
            <EmptyState title="No API keys yet" description='Click "Create API key" above, or run: npm run create-key -- <name>' />
          )}
        </div>
      )}

      {showCreate && (
        <CreateKeyDialog
          adminKey={adminKey}
          onClose={() => setShowCreate(false)}
          onCreated={reload}
          onUseInPlayground={
            onUseKeyInPlayground
              ? (key) => {
                  onUseKeyInPlayground(key);
                  setShowCreate(false);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
