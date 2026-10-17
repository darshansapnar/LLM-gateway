// App-level store for the Playground page's state, so it survives
// navigating to another dashboard tab and back - previously all of this
// lived in useState inside pages/Playground.jsx, which gets unmounted
// (and its state thrown away) every time App.jsx switches `activeTab` to
// render a different page. Lifting it into a Context provider mounted once
// in App.jsx (alongside Sidebar, never unmounted while logged in) fixes
// that: the page component becomes a thin view that reads/writes this
// store instead of owning the state itself.
//
// This also fixes "navigate away mid-stream": the actual fetch + SSE
// reading loop (performSend below) is a plain async function owned by this
// provider, not by the page component - so switching tabs mid-stream
// doesn't abort anything or throw a "set state on an unmounted component"
// warning, because the component whose state setters it calls (this one)
// is never unmounted. The stream keeps running in the background and
// Playground shows wherever it got to when you come back.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { sendPlainRequest, sendStreamingRequest } from "../lib/playground/sendRequest.js";
import { useRememberedApiKey } from "../hooks/useRememberedApiKey.js";
import { loadPersistedState, savePersistedState, clearPersistedState } from "../lib/playground/persistence.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
const DEFAULT_DEMO_ENDPOINT = `${API_BASE}/demo/chat`;
const DEFAULT_AUTH_ENDPOINT = `${API_BASE}/v1/chat`;
const DEFAULT_ENDPOINT = DEFAULT_DEMO_ENDPOINT;
const DEFAULT_BODY = JSON.stringify({ prompt: "How do I turn on dark mode in VS Code?" }, null, 2);

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

const PlaygroundContext = createContext(null);

export function usePlaygroundStore() {
  const ctx = useContext(PlaygroundContext);
  if (!ctx) throw new Error("usePlaygroundStore must be used inside <PlaygroundProvider>");
  return ctx;
}

export function PlaygroundProvider({ children }) {
  // Hydrated once from sessionStorage (if present) on first mount - note
  // this provider itself only mounts once per login session (see App.jsx),
  // so "first mount" really does mean "page load/refresh", not "switched
  // to the Playground tab". The lazy useState initializer (not a plain
  // call, not useRef(fn())) is what guarantees loadPersistedState() - and
  // the sessionStorage read/JSON.parse inside it - only runs once, not on
  // every render.
  const [initial] = useState(() => loadPersistedState() || {});

  const [endpoint, setEndpoint] = useState(initial?.endpoint || DEFAULT_ENDPOINT);
  // The gateway key stays governed entirely by its own hook - in memory
  // only unless the developer explicitly checked "remember" (sessionStorage
  // then, never localStorage) - this store never persists it itself.
  const { apiKey, setApiKey, remember: rememberKey, setRemember: setRememberKey } = useRememberedApiKey();
  const [headers, setHeaders] = useState(initial?.headers || defaultHeaderRows());
  const [bodyText, setBodyText] = useState(initial?.bodyText ?? DEFAULT_BODY);
  const [bodyError, setBodyError] = useState(null);
  const [streamEnabled, setStreamEnabled] = useState(initial?.streamEnabled ?? false);
  const [bypassEnabled, setBypassEnabled] = useState(initial?.bypassEnabled ?? false);
  const [semanticCacheStatus, setSemanticCacheStatus] = useState("unknown");
  const [piiModeStatus, setPiiModeStatus] = useState("unknown");
  const [demoRemaining, setDemoRemaining] = useState(null);
  const [demoLimit, setDemoLimit] = useState(null);

  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [frontendError, setFrontendError] = useState(null);
  // Never persisted (see persistence.js) - may hold PII restored to its
  // real value for this caller; kept in memory only, same as the API key.
  const [response, setResponse] = useState(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const [history, setHistory] = useState(initial?.history || []);

  const abortRef = useRef(null);

  // Mirrors the non-secret, non-response subset of state into
  // sessionStorage on every change, so a page REFRESH restores it too (not
  // just a tab switch, which the Context itself already handles).
  useEffect(() => {
    savePersistedState({ endpoint, headers, bodyText, streamEnabled, bypassEnabled, history });
  }, [endpoint, headers, bodyText, streamEnabled, bypassEnabled, history]);

  function buildHeaderList() {
    const isDemoEndpoint = endpoint.includes("/demo/chat");
    return headers
      .filter((row) => !(isDemoEndpoint && row.key.trim().toLowerCase() === "authorization" && !apiKey))
      .map((row) => {
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
  // can replay the EXACT request object that was actually sent, even if
  // the editor has since changed.
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
        if (headersObj["x-pii-mode"]) setPiiModeStatus(headersObj["x-pii-mode"]);
        if (headersObj["x-ratelimit-remaining"] !== undefined) {
          setDemoRemaining(Number(headersObj["x-ratelimit-remaining"]));
        }
        if (headersObj["x-ratelimit-limit"] !== undefined) {
          setDemoLimit(Number(headersObj["x-ratelimit-limit"]));
        }

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
        if (headersObj["x-pii-mode"]) setPiiModeStatus(headersObj["x-pii-mode"]);
        if (headersObj["x-ratelimit-remaining"] !== undefined) {
          setDemoRemaining(Number(headersObj["x-ratelimit-remaining"]));
        }
        if (headersObj["x-ratelimit-limit"] !== undefined) {
          setDemoLimit(Number(headersObj["x-ratelimit-limit"]));
        }

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
    const isDemoEndpoint = endpoint.includes("/demo/chat");
    if (!isDemoEndpoint && !apiKey.trim()) {
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

  // Clears the request form AND history AND the sessionStorage mirror back
  // to defaults - everything this store owns except the API key, which has
  // its own dedicated clear path (empty the field in AuthSection, or
  // uncheck "remember") so a routine Reset can't accidentally sign you out
  // of a key you're still testing with.
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
    setLastPrompt("");
    setHistory([]);
    clearPersistedState();
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
    if (!item.response) return; // rehydrated-after-refresh entry - response was never persisted
    setResponse(item.response);
    setFrontendError(null);
  }

  function handleHistoryResend(item) {
    setBodyError(null);
    const isDemoEndpoint = endpoint.includes("/demo/chat");
    if (!isDemoEndpoint && !apiKey.trim()) {
      setFrontendError("Set a Gateway API Key first - it's sent as the Authorization header.");
      return;
    }
    setBodyText(JSON.stringify(item.snapshot.bodyObject, null, 2));
    setStreamEnabled(Boolean(item.snapshot.isStream));

    // A full in-memory snapshot (this session, not yet refreshed) carries
    // its own resolved headerList (real key baked in, exactly as it was
    // sent) and replays verbatim. A rehydrated-after-refresh entry only
    // kept {bodyObject, isStream} (see persistence.js's
    // toPersistableHistory) - the real key was never written to
    // sessionStorage, so headers are rebuilt fresh from whatever's
    // currently in the API key field instead of a frozen, stripped one.
    if (item.snapshot?.headerList) {
      performSend(item.snapshot);
    } else {
      const headerList = buildHeaderList();
      if (bypassEnabled) headerList.push({ key: "x-cache-bypass", value: "true" });
      performSend({ bodyObject: item.snapshot.bodyObject, headerList, isStream: Boolean(item.snapshot.isStream) });
    }
  }

  function handleClearHistory() {
    setHistory([]);
  }

  const isDemo = endpoint.includes("/demo/chat");

  const value = useMemo(
    () => ({
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
      demoRemaining,
      demoLimit,
      isDemo,
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
    }),
    // Deliberately NOT exhaustive on every handler's captured values -
    // these closures already read current state directly (not via stale
    // refs), so re-creating `value` on every state change (the dependency
    // list below) is what keeps them fresh; useCallback would just add
    // noise here without changing behavior, since nothing downstream relies
    // on referential stability of these functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      endpoint,
      apiKey,
      rememberKey,
      headers,
      bodyText,
      bodyError,
      streamEnabled,
      bypassEnabled,
      semanticCacheStatus,
      piiModeStatus,
      demoRemaining,
      demoLimit,
      isDemo,
      loading,
      loadingLabel,
      frontendError,
      response,
      lastPrompt,
      history,
    ]
  );

  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;
}
