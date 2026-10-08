import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { formatLatency } from "../../lib/format.js";

const TABS = ["Response", "Raw", "Headers", "Metadata"];

// These are the headers the gateway specifically exposes via CORS (see
// src/app.js) and that matter for understanding what happened - pulled to
// the top of the Headers tab instead of sorted alphabetically with the rest.
const HIGHLIGHT_HEADERS = [
  "x-cache",
  "x-provider",
  "x-semantic-cache",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "retry-after",
  "x-request-id",
  "content-type",
];

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text ?? "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // Clipboard access denied - nothing useful to do about it here.
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ResponseBody({ response }) {
  const [expanded, setExpanded] = useState(true);
  const text =
    response.streamedText ??
    response.json?.response ??
    (response.json?.error ? `Error: ${response.json.error}${response.json.details ? ` — ${response.json.details}` : ""}` : "");
  const jsonPretty = response.json ? JSON.stringify(response.json, null, 2) : response.rawText || "(empty)";

  return (
    <div className="flex flex-col gap-3">
      {text && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-soft">Answer</span>
            <CopyButton text={text} />
          </div>
          <div className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink">
            {text}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-ink-soft">JSON</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="text-xs font-medium text-ink-muted hover:text-ink-soft"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
            <CopyButton text={jsonPretty} />
          </div>
        </div>
        {expanded && (
          <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs leading-5 text-ink-soft">
            {jsonPretty}
          </pre>
        )}
      </div>
    </div>
  );
}

function RawView({ response }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink-soft">{response.streamed ? "Raw SSE events" : "Raw body"}</span>
        <CopyButton text={response.rawText} />
      </div>
      <pre className="max-h-96 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs leading-5 text-ink-soft">
        {response.rawText || "(empty)"}
      </pre>
    </div>
  );
}

function HeadersView({ headersObj }) {
  const entries = Object.entries(headersObj || {});
  const highlighted = entries.filter(([key]) => HIGHLIGHT_HEADERS.includes(key));
  const rest = entries.filter(([key]) => !HIGHLIGHT_HEADERS.includes(key));

  if (entries.length === 0) {
    return <p className="text-xs text-ink-muted">No headers readable from the browser for this response.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {highlighted.length > 0 && (
        <table className="w-full text-xs">
          <tbody className="divide-y divide-line">
            {highlighted.map(([key, value]) => (
              <tr key={key}>
                <td className="w-1/3 py-1.5 pr-3 align-top font-mono font-semibold text-accent">{key}</td>
                <td className="py-1.5 font-mono text-ink">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rest.length > 0 && (
        <table className="w-full text-xs">
          <tbody className="divide-y divide-line">
            {rest.map(([key, value]) => (
              <tr key={key}>
                <td className="w-1/3 py-1.5 pr-3 align-top font-mono text-ink-muted">{key}</td>
                <td className="py-1.5 font-mono text-ink-soft">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Field order mirrors the task's metadata list; only fields actually
// present on this response's JSON are rendered - never a fixed table with
// blanks for whatever the backend didn't return.
const METADATA_FIELDS = [
  ["provider", "Provider"],
  ["model", "Model"],
  ["cacheType", "Cache type"],
  ["similarity", "Similarity"],
  ["matchedPrompt", "Matched prompt"],
  ["verifierResult", "Verifier result"],
  ["fallbackUsed", "Fallback used"],
  ["tokensSaved", "Tokens saved"],
  ["costUsd", "Cost (USD)"],
  ["costSavedUsd", "Cost saved (USD)"],
  ["ttftMs", "TTFT (ms)"],
  ["latencyMs", "Latency (ms, server-reported)"],
  ["requestId", "Request ID"],
];

function MetadataView({ response }) {
  const json = response.json || {};
  const rows = METADATA_FIELDS.filter(([key]) => json[key] !== undefined && json[key] !== null);
  const attempts = Array.isArray(json.attempts) ? json.attempts : [];

  if (rows.length === 0 && attempts.length === 0) {
    return <p className="text-xs text-ink-muted">No metadata fields present on this response.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 && (
        <table className="w-full text-xs">
          <tbody className="divide-y divide-line">
            {rows.map(([key, label]) => (
              <tr key={key}>
                <td className="w-1/3 py-1.5 pr-3 align-top text-ink-muted">{label}</td>
                <td className="py-1.5 font-mono text-ink">{String(json[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {attempts.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-soft">Attempts</div>
          <ul className="flex flex-col gap-1.5">
            {attempts.map((attempt, index) => (
              <li key={index} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs">
                <span className={attempt.success ? "text-good-ink" : "text-bad-ink"}>{attempt.success ? "✓" : "✕"}</span>
                <span className="font-medium text-ink">{attempt.provider}</span>
                <span className="font-mono text-ink-muted">{formatLatency(attempt.latencyMs)}</span>
                {attempt.error && <span className="truncate text-bad-ink">{attempt.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ResponseTabs({ response }) {
  const [tab, setTab] = useState("Response");

  return (
    <div>
      <div className="mb-3 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "border-b-2 border-accent px-3 py-2 text-xs font-semibold text-accent"
                : "border-b-2 border-transparent px-3 py-2 text-xs font-medium text-ink-muted hover:text-ink-soft"
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Response" && <ResponseBody response={response} />}
      {tab === "Raw" && <RawView response={response} />}
      {tab === "Headers" && <HeadersView headersObj={response.headersObj} />}
      {tab === "Metadata" && <MetadataView response={response} />}
    </div>
  );
}
