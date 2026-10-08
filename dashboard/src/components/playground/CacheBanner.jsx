import { AlertTriangle, Database, SkipForward, Zap } from "lucide-react";

const TONE_CLASSES = {
  good: "border-good-bg bg-good-bg/60 text-good-ink",
  accent: "border-accent-soft bg-accent-soft text-accent-soft-ink",
  warn: "border-warn-bg bg-warn-bg/60 text-warn-ink",
  neutral: "border-line bg-surface-2 text-ink-soft",
};

function Banner({ tone, icon: Icon, text, detail, emphasize }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${TONE_CLASSES[tone]} ${
        emphasize ? "ring-1 ring-warn" : ""
      }`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{text}</div>
        {detail && <div className="mt-0.5 break-words text-xs opacity-80">{detail}</div>}
      </div>
    </div>
  );
}

// Tells the single most important story in the response at a glance: did
// this request actually reach a provider, or did the cache handle it (and
// if a semantic candidate was found but turned down, say so clearly - it's
// the whole point of the verifier pipeline).
export default function CacheBanner({ xCache, similarity, matchedPrompt, verifierResult }) {
  if (!xCache) return null;

  if (xCache === "HIT-EXACT") {
    return <Banner tone="good" icon={Zap} text="Exact cache hit — provider request avoided." />;
  }

  if (xCache === "HIT-SEMANTIC") {
    return (
      <Banner
        tone="accent"
        icon={Database}
        text={`Semantic cache hit — similarity ${similarity != null ? similarity.toFixed(2) : "?"} — provider request avoided.`}
        detail={matchedPrompt ? `Matched: "${matchedPrompt}"` : null}
      />
    );
  }

  if (xCache === "BYPASS") {
    return <Banner tone="warn" icon={SkipForward} text="Cache bypassed — fresh provider request forced." />;
  }

  // MISS - was there a semantic candidate that got rejected along the way?
  const rejected = verifierResult && !verifierResult.toLowerCase().startsWith("accepted");
  if (rejected) {
    return (
      <Banner
        tone="warn"
        icon={AlertTriangle}
        text="Similar cached prompt found but rejected — sent to provider."
        detail={verifierResult}
        emphasize
      />
    );
  }

  return <Banner tone="neutral" icon={Database} text="Cache miss — request sent to provider." />;
}
