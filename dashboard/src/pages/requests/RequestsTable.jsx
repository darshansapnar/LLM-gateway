import Badge from "../../components/common/Badge.jsx";
import EmptyState from "../../components/common/EmptyState.jsx";
import { SkeletonTableRows } from "../../components/common/Skeleton.jsx";
import { formatLatency, formatNumber, formatRelativeTime, formatUsd } from "../../lib/format.js";
import { cacheTypeTone, requestStatusTone } from "../../lib/badgeTone.js";

const COLUMNS = ["Time", "Provider", "Status", "Cache", "Latency", "Tokens", "Cost", "Prompt"];

export default function RequestsTable({ logs, loading, onSelect }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              {COLUMNS.map((col) => (
                <th key={col} className="whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-ink-soft">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {loading ? (
              <SkeletonTableRows rows={8} cols={COLUMNS.length} />
            ) : (
              logs.map((log) => (
                <tr key={log._id} onClick={() => onSelect(log)} className="cursor-pointer hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-muted">{formatRelativeTime(log.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge tone="neutral">{log.provider}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge tone={requestStatusTone(log.status)} dot>
                      {log.status}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <Badge tone={cacheTypeTone(log.cacheType)}>{log.cacheType}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-soft">{formatLatency(log.latencyMs)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-soft">
                    {formatNumber(log.inputTokens)}/{formatNumber(log.outputTokens)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-soft">{formatUsd(log.costUsd)}</td>
                  <td className="max-w-[320px] truncate px-4 py-2.5 text-ink-soft">{log.prompt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && logs.length === 0 && (
        <EmptyState title="No requests yet" description="Send one through the gateway to see it show up here." />
      )}
    </div>
  );
}
