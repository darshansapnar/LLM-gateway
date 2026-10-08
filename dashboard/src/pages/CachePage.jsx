import { Database, Gauge, Gavel, PiggyBank, ShieldCheck, Sigma, Timer, UserX } from "lucide-react";
import { usePolling } from "../hooks/usePolling.js";
import { getCacheStats } from "../api.js";
import PageHeader from "../components/layout/PageHeader.jsx";
import ErrorBanner from "../components/common/ErrorBanner.jsx";
import KpiCard from "../components/common/KpiCard.jsx";
import CompositionMeter from "../components/common/CompositionMeter.jsx";
import { SkeletonKpiCard, SkeletonChartCard } from "../components/common/Skeleton.jsx";
import VerifierBarChart from "../components/charts/VerifierBarChart.jsx";
import { formatLatency, formatNumber, formatPercent, formatUsd } from "../lib/format.js";

// Cache-specific detail that doesn't fit the Overview KPIs: exact vs
// semantic hit counts, what caching has actually saved, how the verifier
// resolved semantic candidates, and the judge's own cost/latency. This is
// all-time data straight from GET /v1/admin/cache-stats (the endpoint has
// no time-range filter, unlike overview/providers/timeseries).
export default function CachePage({ adminKey, onOpenMobileNav }) {
  const { data, loading, error, lastUpdated, reload } = usePolling(() => getCacheStats(adminKey), [adminKey]);

  return (
    <section>
      <PageHeader title="Cache" lastUpdated={lastUpdated} onRefresh={reload} onOpenMobileNav={onOpenMobileNav} />

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {!error && loading && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonKpiCard key={i} />)}
          </div>
          <div className="mt-4">
            <SkeletonChartCard />
          </div>
        </>
      )}

      {!error && !loading && data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard icon={Gauge} label="Overall hit rate" value={formatPercent(data.hitRate)} />
            <KpiCard icon={Database} label="Exact hits" value={formatNumber(data.exactHits)} />
            <KpiCard icon={Database} label="Semantic hits" value={formatNumber(data.semanticHits)} />
            <KpiCard icon={UserX} label="Misses" value={formatNumber(data.misses)} />
            <KpiCard icon={Sigma} label="Tokens saved" value={formatNumber(data.tokensSaved)} />
            <KpiCard icon={PiggyBank} label="Cost saved" value={formatUsd(data.costSavedUsd)} />
            <KpiCard icon={Gavel} label="Judge calls" value={formatNumber(data.verifier.judgeCalls)} secondary={formatUsd(data.verifier.judgeCostUsd)} />
            <KpiCard icon={Timer} label="Avg judge latency" value={formatLatency(data.verifier.avgJudgeLatencyMs)} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-4">
              <h3 className="text-sm font-medium text-ink">Hit composition</h3>
              <div className="mt-4">
                <CompositionMeter
                  segments={[
                    { label: "Exact", value: data.exactHits, tone: "good" },
                    { label: "Semantic", value: data.semanticHits, tone: "accent" },
                    { label: "Miss", value: data.misses, tone: "neutral" },
                  ]}
                />
              </div>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-muted">
                <ShieldCheck size={13} />
                {formatNumber(data.semanticSkippedOptOut)} requests skipped semantic caching (key not opted in)
              </p>
            </div>

            <VerifierBarChart verifier={data.verifier} />
          </div>
        </>
      )}
    </section>
  );
}
