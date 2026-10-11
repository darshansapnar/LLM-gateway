import { useEffect, useMemo } from "react";
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
import { buildFlowSummary } from "../lib/playground/buildFlowSummary.js";
import { mapScenarioId } from "../lib/playground/mapScenario.js";
import { usePlaygroundStore } from "../store/PlaygroundStore.jsx";

const CACHE_LABELS = { "HIT-EXACT": "Exact HIT", "HIT-SEMANTIC": "Semantic HIT", MISS: "Miss", BYPASS: "Bypassed" };

// The Playground: builds and sends REAL requests to POST /v1/chat (never
// to Groq/Gemini directly - the gateway is the only thing this page talks
// to) and lets a developer inspect everything about the response. All the
// actual state and network logic lives in store/PlaygroundStore.jsx (an
// app-level Context, mounted once in App.jsx) - this component is just the
// view, so switching to another dashboard tab and back doesn't lose
// anything (see PlaygroundStore.jsx's top comment for why). Presentational
// pieces live in components/playground/ - see lib/playground/ for the
// request-sending, flow-summary, and scenario-matching logic.
export default function Playground({ onOpenMobileNav, onNavigate, playgroundPrefillKey, onPrefillConsumed }) {
  const store = usePlaygroundStore();
  const {
    endpoint,
    setEndpoint,
    apiKey,
    setApiKey,
    rememberKey,
    setRememberKey,
    headers,
    setHeaders,
    bodyText,
    setBodyText,
    bodyError,
    streamEnabled,
    setStreamEnabled,
    bypassEnabled,
    setBypassEnabled,
    semanticCacheStatus,
    piiModeStatus,
    loading,
    loadingLabel,
    frontendError,
    response,
    lastPrompt,
    history,
    handleSend,
    handleStop,
    handleReset,
    handleFormatJson,
    handleClearBody,
    handlePickExample,
    handleHistorySelect,
    handleHistoryResend,
    handleClearHistory,
  } = store;

  // One-shot prefill from ApiKeysPage's "Use in Playground" (App.jsx holds
  // the value in plain React state - never the URL, never storage). Runs
  // once per mount, then tells App.jsx to forget it so switching away and
  // back to this tab later doesn't silently re-inject a stale key. Safe to
  // keep mount-scoped even now that the underlying key state lives in the
  // store: a fresh prefill is a new, deliberate "use this key" action from
  // the API Keys page, not something that should replay just because this
  // view remounted after passive navigation.
  useEffect(() => {
    if (playgroundPrefillKey) {
      setApiKey(playgroundPrefillKey);
      onPrefillConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              piiModeStatus={piiModeStatus}
              onEditPiiSettings={onNavigate ? () => onNavigate("/api-keys") : undefined}
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
