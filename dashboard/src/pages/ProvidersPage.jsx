import { useMemo, useState } from "react";
import { usePolling } from "../hooks/usePolling.js";
import { getProviders, getLogs } from "../api.js";
import PageHeader from "../components/layout/PageHeader.jsx";
import ErrorBanner from "../components/common/ErrorBanner.jsx";
import StatusBadge from "../components/common/StatusBadge.jsx";
import ProgressBar from "../components/common/ProgressBar.jsx";
import { SkeletonChartCard } from "../components/common/Skeleton.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import ProviderSparkline from "../components/charts/ProviderSparkline.jsx";
import { formatLatency, formatNumber, formatPercent, formatUsd } from "../lib/format.js";

// One card per provider in PROVIDER_ORDER: health, success rate, latency,
// request volume, cost, and a recent-latency trend line. The trend line is
// built from the last 50 request logs (an endpoint already used elsewhere
// in the dashboard) grouped by provider - the providers endpoint itself has
// no time-bucketed latency series to draw a sparkline from.
export default function ProvidersPage({ adminKey, onOpenMobileNav }) {
  const [range, setRange] = useState("24h");
  const providers = usePolling(() => getProviders(adminKey, range), [adminKey, range]);
  const recentLogs = usePolling(() => getLogs(adminKey, { page: 1, limit: 50 }), [adminKey]);

  const sparklines = useMemo(() => {
    const byProvider = {};
    for (const log of recentLogs.data?.logs ?? []) {
      (byProvider[log.provider] ??= []).push(log.latencyMs);
    }
    // Logs arrive newest-first; reverse so sparklines read left-to-right in time.
    for (const name of Object.keys(byProvider)) byProvider[name].reverse();
    return byProvider;
  }, [recentLogs.data]);

  const entries = providers.data ? Object.entries(providers.data) : [];

  return (
    <section>
      <PageHeader
        title="Providers"
        range={range}
        onRangeChange={setRange}
        lastUpdated={providers.lastUpdated}
        onRefresh={() => {
          providers.reload();
          recentLogs.reload();
        }}
        onOpenMobileNav={onOpenMobileNav}
      />

      {providers.error && <ErrorBanner message={providers.error} onRetry={providers.reload} />}

      {!providers.error && providers.loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonChartCard key={i} height={140} />)}
        </div>
      )}

      {!providers.error && !providers.loading && entries.length === 0 && (
        <EmptyState title="No providers configured" description="Set PROVIDER_ORDER in .env to see providers here." />
      )}

      {!providers.error && !providers.loading && entries.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map(([name, stats]) => (
            <div key={name} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize text-ink">{name}</h3>
                <StatusBadge state={stats.circuitState} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-ink-muted">Requests</div>
                  <div className="font-mono text-ink">{formatNumber(stats.requestCount)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Avg latency</div>
                  <div className="font-mono text-ink">{formatLatency(stats.avgLatencyMs)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Total cost</div>
                  <div className="font-mono text-ink">{formatUsd(stats.totalCostUsd)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Recent latency</div>
                  <ProviderSparkline points={sparklines[name]} />
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs text-ink-muted">
                  <span>Success rate</span>
                  <span className="font-mono">{formatPercent(stats.successRate)}</span>
                </div>
                <ProgressBar ratio={stats.successRate} tone={stats.successRate < 0.9 ? "warn" : "good"} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
