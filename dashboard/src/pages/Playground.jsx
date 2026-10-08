import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/layout/PageHeader.jsx";
import RequestBar from "../components/playground/RequestBar.jsx";
import AuthSection from "../components/playground/AuthSection.jsx";
import HeadersEditor from "../components/playground/HeadersEditor.jsx";
import JsonEditor from "../components/playground/JsonEditor.jsx";
import ExampleChips from "../components/playground/ExampleChips.jsx";
import AdvancedOptions from "../components/playground/AdvancedOptions.jsx";
import ResponsePanel from "../components/playground/ResponsePanel.jsx";
import RequestMetrics from "../components/playground/RequestMetrics.jsx";
import FlowSummary from "../components/playground/FlowSummary.jsx";
import RequestHistory from "../components/playground/RequestHistory.jsx";
import { sendPlainRequest, sendStreamingRequest } from "../lib/playground/sendRequest.js";
import { buildFlowSummary } from "../lib/playground/buildFlowSummary.js";
import { mapScenarioId } from "../lib/playground/mapScenario.js";
import { useRememberedApiKey } from "../hooks/useRememberedApiKey.js";

const DEFAULT_ENDPOINT = `${import.meta.env.VITE_API_URL || "http://localhost:3000"}/v1/chat`;
const DEFAULT_BODY = JSON.stringify({ prompt: "Explain how LLM gateways work in simple terms." }, null, 2);

function defaultHeaderRows() {
  return [
    { id: "content-type", key: "Content-Type", value: "application/json" },
    { id: "authorization", key: "Authorization", value: "" },
  ];
}

function headersToPlainObject(headers) {
  const obj = {};
  for (const [key, value] of headers.entries()) obj[key] = value;
  return obj;
}

const CACHE_LABELS = { "HIT-EXACT": "Exact HIT", "HIT-SEMANTIC": "Semantic HIT", MISS: "Miss", BYPASS: "Bypassed" };

function statusBadgeTone(status) {
  if (status >= 200 && status < 300) return "good";
  if (status === 429) return "warn";
  return "bad";
}

function cacheBadgeTone(xCache) {
  if (xCache === "HIT-EXACT") return "good";
  if (xCache === "HIT-SEMANTIC") return "accent";
  if (xCache === "BYPASS") return "warn";
  return "neutral";
}

let historySeq = 0;

// The Playground: builds and sends REAL requests to POST /v1/chat (never
// to Groq/Gemini directly - the gateway is the only thing this page talks
// to) and lets a developer inspect everything about the response. All
// state lives here and is threaded down to the small presentational
// components in components/playground/ - see lib/playground/ for the
// request-sending, flow-summary, and scenario-matching logic.
export default function Playground({ onOpenMobileNav, onNavigate, playgroundPrefillKey, onPrefillConsumed }) {
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  // Unchecked by default - see hooks/useRememberedApiKey.js. Only ever
  // stores the gateway key typed in below, never a provider key or the
  // admin key (neither of which this page even has access to).
  const { apiKey, setApiKey, remember: rememberKey, setRemember: setRememberKey } = useRememberedApiKey();
  const [headers, setHeaders] = useState(defaultHeaderRows);

  // One-shot prefill from ApiKeysPage's "Use in Playground" (App.jsx holds
  // the value in plain React state - never the URL, never storage). Runs
  // once on mount, then tells App.jsx to forget it so switching away and
  // back to this tab later doesn't re-apply a stale key.
  useEffect(() => {
    if (playgroundPrefillKey) {
      setApiKey(playgroundPrefillKey);
      onPrefillConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [bodyText, setBodyText] = useState(DEFAULT_BODY);
  const [bodyError, setBodyError] = useState(null);
  const [streamEnabled, setStreamEnabled] = useState(false);
  const [bypassEnabled, setBypassEnabled] = useState(false);
  const [semanticCacheStatus, setSemanticCacheStatus] = useState("unknown");

  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [frontendError, setFrontendError] = useState(null);
  const [response, setResponse] = useState(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [history, setHistory] = useState([]);

  const abortRef = useRef(null);

  function buildHeaderList() {
    return headers.map((row) => {
      if (row.key.trim().toLowerCase() === "authorization") {
        return { key: row.key, value: apiKey ? `Bearer ${apiKey}` : "" };
      }
      return { key: row.key, value: row.value };
    });
  }

  function pushHistory(promptSent, finalResponse, snapshot) {
    historySeq += 1;
    const xCache = finalResponse.headersObj?.["x-cache"];
    setHistory((prev) =>
      [
        {
          id: historySeq,
          time: new Date(),
          prompt: promptSent || "(no prompt)",
          status: finalResponse.status,
          statusTone: statusBadgeTone(finalResponse.status),
          provider: finalResponse.json?.provider,
          cacheLabel: xCache ? CACHE_LABELS[xCache] || xCache : null,
          cacheTone: cacheBadgeTone(xCache),
          latencyMs: finalResponse.latencyMs,
          snapshot,
          response: finalResponse,
        },
        ...prev,
      ].slice(0, 25)
    );
  }

  // The actual network call. Takes everything it needs as explicit
  // arguments (not read from component state) so "Re-send" from history
  // can replay the EXACT request that was sent before, even if the editor
  // has since changed.
  async function performSend({ bodyObject, headerList, isStream }) {
    const bodyToSend = JSON.stringify(bodyObject);
    const promptSent = typeof bodyObject.prompt === "string" ? bodyObject.prompt : "";

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadingLabel("Sending request…");
    setFrontendError(null);
    setResponse(null);

    try {
      let result;

      if (isStream) {
        let streamedText = "";
        result = await sendStreamingRequest({
          endpoint,
          headerList,
          bodyText: bodyToSend,
          signal: controller.signal,
          onEvent: (payload, meta) => {
            if (payload.delta !== undefined) {
              streamedText += payload.delta;
              setLoadingLabel(`Receiving response… chunk ${meta.chunkCount}`);
              setResponse({
                streamed: true,
                streamedText,
                chunkCount: meta.chunkCount,
                ttftMs: meta.ttftMs,
                latencyMs: meta.elapsedMs,
                status: 200,
                statusText: "OK (streaming)",
                ok: true,
                headersObj: {},
                json: null,
              });
            }
          },
        });

        const headersObj = headersToPlainObject(result.headers);
        if (headersObj["x-semantic-cache"]) setSemanticCacheStatus(headersObj["x-semantic-cache"]);

        const streamFailed = Boolean(result.json?.error);
        const finalResponse = {
          status: result.status,
          statusText: streamFailed ? "Stream Error" : result.statusText,
          ok: result.ok,
          latencyMs: result.latencyMs,
          headersObj,
          json: result.json,
          rawText: result.rawText,
          streamed: result.streamed,
          chunkCount: result.chunkCount,
          ttftMs: result.ttftMs,
          streamedText: result.streamed ? streamedText : undefined,
        };
        setResponse(finalResponse);
        pushHistory(promptSent, finalResponse, { bodyObject, headerList, isStream });
      } else {
        result = await sendPlainRequest({ endpoint, headerList, bodyText: bodyToSend, signal: controller.signal });
        const headersObj = headersToPlainObject(result.headers);
        if (headersObj["x-semantic-cache"]) setSemanticCacheStatus(headersObj["x-semantic-cache"]);

        const finalResponse = {
          status: result.status,
          statusText: result.statusText,
          ok: result.ok,
          latencyMs: result.latencyMs,
          headersObj,
          json: result.json,
          rawText: result.rawText,
          streamed: false,
        };
        setResponse(finalResponse);
        pushHistory(promptSent, finalResponse, { bodyObject, headerList, isStream });
      }

      if (promptSent) setLastPrompt(promptSent);
    } catch (err) {
      setResponse(null);
      setFrontendError(err.aborted ? "Request stopped." : err.message);
    } finally {
      setLoading(false);
      setLoadingLabel("");
      abortRef.current = null;
    }
  }

  function handleSend() {
    if (!apiKey.trim()) {
      setFrontendError("Set a Gateway API Key first - it's sent as the Authorization header.");
      setResponse(null);
      return;
    }

    let parsedBody;
    try {
      parsedBody = bodyText.trim() ? JSON.parse(bodyText) : {};
      setBodyError(null);
    } catch (err) {
      setBodyError(`Invalid JSON - nothing was sent: ${err.message}`);
      return;
    }

    const bodyObject = { ...parsedBody };
    if (streamEnabled) bodyObject.stream = true;
    else delete bodyObject.stream;

    const headerList = buildHeaderList();
    if (bypassEnabled) headerList.push({ key: "x-cache-bypass", value: "true" });

    performSend({ bodyObject, headerList, isStream: streamEnabled });
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleReset() {
    abortRef.current?.abort();
    setEndpoint(DEFAULT_ENDPOINT);
    setHeaders(defaultHeaderRows());
    setBodyText(DEFAULT_BODY);
    setBodyError(null);
    setStreamEnabled(false);
    setBypassEnabled(false);
    setFrontendError(null);
    setResponse(null);
    setLoading(false);
  }

  function handleFormatJson() {
    try {
      const parsed = JSON.parse(bodyText);
      setBodyText(JSON.stringify(parsed, null, 2));
      setBodyError(null);
    } catch (err) {
      setBodyError(`Can't format - invalid JSON: ${err.message}`);
    }
  }

  function handleClearBody() {
    setBodyText("");
    setBodyError(null);
  }

  function handlePickExample(prompt) {
    setBodyText(JSON.stringify({ prompt }, null, 2));
    setBodyError(null);
  }

  function handleHistorySelect(item) {
    setResponse(item.response);
    setFrontendError(null);
  }

  function handleHistoryResend(item) {
    setBodyText(JSON.stringify(item.snapshot.bodyObject, null, 2));
    setStreamEnabled(Boolean(item.snapshot.isStream));
    setBodyError(null);
    if (!apiKey.trim()) {
      setFrontendError("Set a Gateway API Key first - it's sent as the Authorization header.");
      return;
    }
    performSend(item.snapshot);
  }

  function handleClearHistory() {
    setHistory([]);
  }

  const flowSteps = useMemo(() => {
    if (!response) return null;
    return buildFlowSummary({
      status: response.status,
      retryAfter: response.headersObj?.["retry-after"],
      cacheType: response.json?.cacheType,
      verifierResult: response.json?.verifierResult,
      fallbackUsed: response.json?.fallbackUsed,
      attempts: response.json?.attempts,
      bypassed: response.headersObj?.["x-cache"] === "BYPASS",
      semanticCacheHeader: response.headersObj?.["x-semantic-cache"],
    });
  }, [response]);

  const scenarioId = useMemo(() => {
    if (!response) return null;
    return mapScenarioId({
      status: response.status,
      cacheType: response.json?.cacheType,
      verifierResult: response.json?.verifierResult,
      fallbackUsed: response.json?.fallbackUsed,
      attempts: response.json?.attempts,
      stream: response.streamed,
      bypassed: response.headersObj?.["x-cache"] === "BYPASS",
      semanticCacheHeader: response.headersObj?.["x-semantic-cache"],
    });
  }, [response]);

  const metricsData = useMemo(() => {
    if (!response) return null;
    const json = response.json || {};
    const xCache = response.headersObj?.["x-cache"];
    return {
      provider: json.provider,
      model: json.model,
      cacheLabel: xCache ? CACHE_LABELS[xCache] || xCache : undefined,
      latencyMs: response.latencyMs,
      ttftMs: json.ttftMs ?? response.ttftMs,
      inputTokens: json.usage?.inputTokens,
      outputTokens: json.usage?.outputTokens,
      totalTokens: json.usage?.totalTokens,
      costUsd: json.costUsd,
      costSavedUsd: json.costSavedUsd,
      tokensSaved: json.tokensSaved,
      fallbackUsed: json.fallbackUsed,
      statusLabel: response.ok ? "Success" : "Error",
      rateLimitRemaining: response.headersObj?.["x-ratelimit-remaining"],
      rateLimitLimit: response.headersObj?.["x-ratelimit-limit"],
    };
  }, [response]);

  function handleViewFullFlow() {
    if (!scenarioId || !onNavigate) return;
    onNavigate(`/request-flow?scenario=${scenarioId}`);
  }

  return (
    <section>
      <PageHeader title="Playground" subtitle="Test your LLM Gateway with real requests." onOpenMobileNav={onOpenMobileNav} />

      <div className="flex flex-col gap-4">
        <RequestBar
          endpoint={endpoint}
          onChangeEndpoint={setEndpoint}
          onSend={handleSend}
          onStop={handleStop}
          onReset={handleReset}
          isSending={loading}
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
            <h2 className="text-sm font-medium text-ink">Request</h2>
            <AuthSection
              apiKey={apiKey}
              onChangeApiKey={setApiKey}
              remember={rememberKey}
              onChangeRemember={setRememberKey}
            />
            <HeadersEditor headers={headers} onChange={setHeaders} apiKey={apiKey} />
            <div>
              <JsonEditor value={bodyText} onChange={setBodyText} error={bodyError} onFormat={handleFormatJson} onClear={handleClearBody} />
              <div className="mt-2">
                <ExampleChips lastPrompt={lastPrompt} onPick={handlePickExample} />
              </div>
            </div>
            <AdvancedOptions
              stream={streamEnabled}
              onChangeStream={setStreamEnabled}
              bypass={bypassEnabled}
              onChangeBypass={setBypassEnabled}
              semanticCacheStatus={semanticCacheStatus}
            />
          </div>

          <ResponsePanel loading={loading} loadingLabel={loadingLabel} frontendError={frontendError} response={response} />
        </div>

        <RequestMetrics data={metricsData} />
        <FlowSummary steps={flowSteps} onViewFullFlow={onNavigate ? handleViewFullFlow : undefined} />
        <RequestHistory history={history} onSelect={handleHistorySelect} onResend={handleHistoryResend} onClear={handleClearHistory} />
      </div>
    </section>
  );
}
