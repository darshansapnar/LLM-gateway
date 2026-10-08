import Badge from "../common/Badge.jsx";
import { formatLatency, formatNumber, formatUsd } from "../../lib/format.js";
import { cacheTypeTone, requestStatusTone } from "../../lib/badgeTone.js";

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

function statusTone(status) {
  if (status.startsWith("success")) return requestStatusTone("success");
  if (status.startsWith("error")) return requestStatusTone("error");
  return "neutral";
}

// The live metrics panel: everything RequestLog would eventually record
// for this (simulated) request, updating as the packet moves.
export default function FlowMetrics({ metrics }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-medium text-ink">Live Metrics</h3>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={statusTone(metrics.status)} dot>
          {metrics.status}
        </Badge>
        <Badge tone={cacheTypeTone(metrics.cacheType === "—" ? "none" : metrics.cacheType)}>{metrics.cacheType} cache</Badge>
        {metrics.fallbackUsed && <Badge tone="warn">fallback used</Badge>}
        {metrics.judgeUsed && <Badge tone="accent">judge used</Badge>}
      </div>

      <div className="mt-2 divide-y divide-line">
        <Row label="Provider" value={metrics.provider} />
        <Row label="Model" value={metrics.model} />
        <Row label="Latency" value={metrics.latencyMs != null ? formatLatency(metrics.latencyMs) : "—"} />
        <Row label="TTFT" value={metrics.ttftMs != null ? formatLatency(metrics.ttftMs) : "—"} />
        <Row
          label="Tokens (in/out/total)"
          value={
            metrics.totalTokens != null
              ? `${formatNumber(metrics.inputTokens)} / ${formatNumber(metrics.outputTokens)} / ${formatNumber(metrics.totalTokens)}`
              : "—"
          }
        />
        <Row label="Cost" value={metrics.costUsd != null ? formatUsd(metrics.costUsd) : "—"} />
        {metrics.tokensSaved != null && <Row label="Tokens saved" value={formatNumber(metrics.tokensSaved)} />}
        <Row label="Similarity" value={metrics.similarity != null ? metrics.similarity.toFixed(3) : "—"} />
        <Row label="Verifier result" value={metrics.verifierResult} />
        {metrics.judgeUsed && (
          <>
            <Row label="Judge latency" value={formatLatency(metrics.judgeLatencyMs)} />
            <Row label="Judge cost" value={formatUsd(metrics.judgeCostUsd)} />
          </>
        )}
        <Row label="Circuit breaker" value={metrics.circuitState} />
      </div>
    </div>
  );
}
