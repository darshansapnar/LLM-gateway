// Thin layer over fetch() for the Playground. The frontend talks ONLY to
// the gateway's own POST /v1/chat - never to Groq/Gemini directly - so
// this is the exact same request shape a real caller would send.
//
// Two entry points: a normal JSON request, and a streaming one. Streaming
// has to use fetch + a manual reader (not EventSource) because the
// backend's SSE response is to a POST, and EventSource can only GET - see
// public/stream-test.html, which this reuses the same parsing approach from.

function headersToObject(headerList) {
  const obj = {};
  for (const { key, value } of headerList) {
    if (key && key.trim()) obj[key.trim()] = value ?? "";
  }
  return obj;
}

// Browsers report a network failure, a DNS failure, and a CORS rejection
// identically (a bare TypeError with no further detail) - there's no way
// for client-side JS to tell them apart, so the message below covers both
// honestly instead of guessing which one it was.
function describeFailure(err, endpoint) {
  if (err.name === "AbortError") {
    const aborted = new Error("Request stopped.");
    aborted.aborted = true;
    return aborted;
  }
  let origin = endpoint;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    // Not a valid absolute URL - show it as typed.
  }
  return new Error(
    `Can't reach the gateway at ${origin} - is the server running? (A CORS rejection looks identical from here; check the browser console for a CORS error specifically.)`
  );
}

async function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function sendPlainRequest({ endpoint, headerList, bodyText, signal }) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(endpoint, { method: "POST", headers: headersToObject(headerList), body: bodyText, signal });
  } catch (err) {
    throw describeFailure(err, endpoint);
  }

  const latencyMs = performance.now() - startedAt;
  const rawText = await response.text();

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: response.headers,
    rawText,
    json: await parseJsonSafely(rawText),
    latencyMs,
    streamed: false,
  };
}

// `onEvent(payload, meta)` fires once per parsed SSE event - `payload` is
// whatever JSON the backend sent (`{delta}`, `{done, ...}`, or `{error}`),
// `meta` is `{ chunkCount, ttftMs, elapsedMs }` so the caller can drive a
// live "chunk N" / TTFT / running-latency display without recomputing it.
export async function sendStreamingRequest({ endpoint, headerList, bodyText, signal, onEvent }) {
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(endpoint, { method: "POST", headers: headersToObject(headerList), body: bodyText, signal });
  } catch (err) {
    throw describeFailure(err, endpoint);
  }

  // A non-2xx response to a streaming request is still a normal JSON error
  // body (auth/rate-limit middleware runs before the route ever decides to
  // switch to SSE) - handle it exactly like the plain path.
  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    return {
      status: response.status,
      statusText: response.statusText,
      ok: false,
      headers: response.headers,
      rawText,
      json: await parseJsonSafely(rawText),
      latencyMs: performance.now() - startedAt,
      streamed: false,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const rawLines = [];
  let chunkCount = 0;
  let ttftMs = null;
  let finalPayload = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line.
      const events = buffer.split("\n\n");
      buffer = events.pop(); // last entry may be incomplete - keep for next read

      for (const event of events) {
        const line = event.trim();
        if (!line.startsWith("data:")) continue;
        rawLines.push(line);

        const payload = JSON.parse(line.slice("data:".length).trim());

        if (payload.delta !== undefined) {
          chunkCount += 1;
          if (ttftMs === null) ttftMs = performance.now() - startedAt;
        } else if (payload.done || payload.error) {
          finalPayload = payload;
        }

        onEvent?.(payload, { chunkCount, ttftMs, elapsedMs: performance.now() - startedAt });
      }
    }
  } catch (err) {
    throw describeFailure(err, endpoint);
  }

  return {
    status: response.status,
    statusText: response.statusText,
    ok: !finalPayload?.error,
    headers: response.headers,
    rawText: rawLines.join("\n"),
    json: finalPayload,
    latencyMs: performance.now() - startedAt,
    streamed: true,
    chunkCount,
    ttftMs,
  };
}
