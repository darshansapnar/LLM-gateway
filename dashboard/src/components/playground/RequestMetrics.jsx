import { Activity, Clock, Cpu, Database, DollarSign, Gauge, GitBranch, Hash, PiggyBank, Repeat, Zap } from "lucide-react";
import KpiCard from "../common/KpiCard.jsx";
import { formatLatency, formatNumber, formatUsd } from "../../lib/format.js";

// A metric card grid built ONLY from fields actually present on this
// response - never a fixed layout with blanks for whatever the backend
// didn't return (e.g. TTFT only exists for streaming requests).
export default function RequestMetrics({ data }) {
  if (!data) return null;

  const cards = [];
  const push = (icon, label, value) => cards.push({ icon, label, value });

  if (data.provider) push(Cpu, "Provider", data.provider);
  if (data.model) push(Cpu, "Model", data.model);
  if (data.cacheLabel) push(Database, "Cache", data.cacheLabel);
  if (data.latencyMs != null) push(Clock, "Latency", formatLatency(data.latencyMs));
  if (data.ttftMs != null) push(Zap, "TTFT", formatLatency(data.ttftMs));
  if (data.inputTokens != null) push(Hash, "Input tokens", formatNumber(data.inputTokens));
  if (data.outputTokens != null) push(Hash, "Output tokens", formatNumber(data.outputTokens));
  if (data.totalTokens != null) push(Hash, "Total tokens", formatNumber(data.totalTokens));
  if (data.costUsd != null) push(DollarSign, "Cost", formatUsd(data.costUsd));
  if (data.costSavedUsd != null) push(PiggyBank, "Cost saved", formatUsd(data.costSavedUsd));
  if (data.tokensSaved != null) push(Repeat, "Tokens saved", formatNumber(data.tokensSaved));
  if (data.fallbackUsed != null) push(GitBranch, "Fallback used", data.fallbackUsed ? "Yes" : "No");
  if (data.statusLabel) push(Activity, "Status", data.statusLabel);
  if (data.rateLimitRemaining != null) {
    push(Gauge, "Rate limit remaining", data.rateLimitLimit ? `${data.rateLimitRemaining} / ${data.rateLimitLimit}` : data.rateLimitRemaining);
  }

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) => (
        <KpiCard key={card.label} icon={card.icon} label={card.label} value={card.value} />
      ))}
    </div>
  );
}
