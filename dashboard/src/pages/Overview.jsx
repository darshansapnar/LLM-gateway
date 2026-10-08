import { useState } from "react";
import { Activity, CheckCircle2, Clock, DollarSign, Gauge, PiggyBank, Timer } from "lucide-react";
import { usePolling } from "../hooks/usePolling.js";
import { getOverview, getTimeseries, getProviders, getLogs } from "../api.js";
import PageHeader from "../components/layout/PageHeader.jsx";
import KpiCard from "../components/common/KpiCard.jsx";
import ErrorBanner from "../components/common/ErrorBanner.jsx";
import Badge from "../components/common/Badge.jsx";
import { SkeletonKpiCard, SkeletonChartCard } from "../components/common/Skeleton.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import RequestsAreaChart from "../components/charts/RequestsAreaChart.jsx";
import SourceDonutChart from "../components/charts/SourceDonutChart.jsx";
import CostBarChart from "../components/charts/CostBarChart.jsx";
import { formatNumber, formatPercent, formatUsd, formatLatency, formatRelativeTime } from "../lib/format.js";
import { requestStatusTone } from "../lib/badgeTone.js";

// The landing page: KPI cards for the selected range, the three timeseries
// charts, and a "recent requests" peek. Everything here polls every 10s and
// restarts fresh whenever `range` changes (see usePolling).
//
// Note on "change vs previous period": the KPI cards below render without
// an up/down indicator because /v1/admin/overview only reports the
// selected range, not the prior equal-length window to compare against.
// Adding that would need either a `previous: {...}` block in that same
// response, or a `compare=true` query flag - see the project's CLAUDE.md
// for this exact call-out.
export default function Overview({ adminKey, onOpenMobileNav }) {
  const [range, setRange] = useState("24h");

  const overview = usePolling(() => getOverview(adminKey, range), [adminKey, range]);
  const timeseries = usePolling(() => getTimeseries(adminKey, range), [adminKey, range]);
  const providers = usePolling(() => getProviders(adminKey, range), [adminKey, range]);
  const recent = usePolling(() => getLogs(adminKey, { page: 1, limit: 5 }), [adminKey]);

  const anyError = overview.error || timeseries.error || providers.error;
  const anyLoading = overview.loading || timeseries.loading || providers.loading;

  return (
    <section>
      <PageHeader
        title="Overview"
        range={range}
        onRangeChange={setRange}
        lastUpdated={overview.lastUpdated}
        onRefresh={() => {
          overview.reload();
          timeseries.reload();
          providers.reload();
          recent.reload();
        }}
        onOpenMobileNav={onOpenMobileNav}
      />

      {anyError && <ErrorBanner message={anyError} onRetry={() => { overview.reload(); timeseries.reload(); providers.reload(); }} />}

      {anyLoading && !anyError ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonKpiCard key={i} />)}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SkeletonChartCard />
            <SkeletonChartCard />
          </div>
        </>
      ) : !anyError && overview.data && timeseries.data && providers.data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard icon={Activity} label="Total requests" value={formatNumber(overview.data.totalRequests)} />
            <KpiCard icon={CheckCircle2} label="Success rate" value={formatPercent(overview.data.successRate)} />
            <KpiCard icon={DollarSign} label="Total cost" value={formatUsd(overview.data.totalCostUsd)} />
            <KpiCard icon={PiggyBank} label="Cost saved" value={formatUsd(overview.data.costSavedUsd)} />
            <KpiCard
              icon={Gauge}
              label="Cache hit rate"
              value={formatPercent(overview.data.cacheHitRate)}
              secondary={`exact ${formatPercent(overview.data.exactHitRate, 0)} · semantic ${formatPercent(overview.data.semanticHitRate, 0)}`}
            />
            <KpiCard icon={Clock} label="Avg latency" value={formatLatency(overview.data.avgLatencyMs)} />
            <KpiCard
              icon={Timer}
              label="Avg TTFT"
              value={overview.data.avgTtftMs !== null ? formatLatency(overview.data.avgTtftMs) : "—"}
              secondary="streaming only"
            />
            <KpiCard
              icon={Activity}
              label="Fallback rate"
              value={formatPercent(overview.data.fallbackRate)}
              secondary={`${formatNumber(overview.data.judgeCalls)} judge calls · ${formatUsd(overview.data.judgeCostUsd)}`}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RequestsAreaChart data={timeseries.data} />
            <SourceDonutChart overview={overview.data} providers={providers.data} />
            <div className="lg:col-span-2">
              <CostBarChart data={timeseries.data} />
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line bg-surface p-4">
            <h3 className="text-sm font-medium text-ink">Recent requests</h3>
            {recent.data?.logs?.length ? (
              <ul className="mt-3 divide-y divide-line">
                {recent.data.logs.map((log) => (
                  <li key={log._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{log.prompt}</span>
                    <span className="shrink-0 font-mono text-xs text-ink-muted">{formatLatency(log.latencyMs)}</span>
                    <span className="shrink-0 text-xs text-ink-muted">{formatRelativeTime(log.createdAt)}</span>
                    <Badge tone={requestStatusTone(log.status)}>{log.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No requests yet" description="Send one through the gateway to see data here." />
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
