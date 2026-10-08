import { Inbox, Loader2 } from "lucide-react";
import Badge from "../common/Badge.jsx";
import EmptyState from "../common/EmptyState.jsx";
import CacheBanner from "./CacheBanner.jsx";
import ResponseTabs from "./ResponseTabs.jsx";
import { formatLatency } from "../../lib/format.js";

function statusTone(status, ok) {
  // `ok` (not just the numeric status) decides the tone, because a
  // streaming response that fails mid-stream still has HTTP status 200 -
  // the failure only shows up in the final SSE event, not the status line.
  if (ok === false) return "bad";
  if (status == null) return "neutral";
  if (status >= 200 && status < 300) return "good";
  if (status === 429) return "warn";
  return "bad";
}

export default function ResponsePanel({ loading, loadingLabel, frontendError, response }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">Response</h2>

      {loading && (
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-soft">
          <Loader2 size={15} className="animate-spin text-accent" />
          {loadingLabel || "Sending request…"}
        </div>
      )}

      {!loading && frontendError && (
        <div className="rounded-lg border border-bad-bg bg-bad-bg/40 px-3 py-2.5 text-sm text-bad-ink">{frontendError}</div>
      )}

      {!loading && !frontendError && !response && (
        <EmptyState icon={Inbox} title="No response yet" description="Send a request to see the response here." />
      )}

      {!loading && response && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(response.status, response.ok)} dot>
              {response.status} {response.statusText}
            </Badge>
            {response.latencyMs != null && <span className="font-mono text-xs text-ink-muted">{formatLatency(response.latencyMs)}</span>}
            {response.streamed && <Badge tone="accent">streamed · {response.chunkCount ?? 0} chunks</Badge>}
          </div>

          {response.status === 429 && (
            <div className="rounded-lg border border-warn-bg bg-warn-bg/50 px-3 py-2.5 text-sm text-warn-ink">
              Rate limited — retry after {response.headersObj?.["retry-after"] ?? "?"}s.
              {response.headersObj?.["x-ratelimit-limit"] && ` Limit: ${response.headersObj["x-ratelimit-limit"]}/min.`}
            </div>
          )}

          {response.status >= 500 && Array.isArray(response.json?.attempts) && response.json.attempts.length > 0 && (
            <div className="rounded-lg border border-bad-bg bg-bad-bg/40 px-3 py-2.5 text-xs text-bad-ink">
              All providers failed - see the Metadata tab for the attempts list.
            </div>
          )}

          <CacheBanner
            xCache={response.headersObj?.["x-cache"]}
            similarity={response.json?.similarity}
            matchedPrompt={response.json?.matchedPrompt}
            verifierResult={response.json?.verifierResult}
          />

          <ResponseTabs response={response} />
        </>
      )}
    </div>
  );
}
