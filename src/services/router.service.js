// Tries providers in PROVIDER_ORDER, one at a time. For each provider:
// skips it if its circuit breaker is open, otherwise calls it with a
// timeout and retries retryable errors (timeout/429/5xx) with exponential
// backoff before giving up and moving to the next provider.
import { env } from "../config/env.js";
import { providers, streamingProviders } from "./providers/index.js";
import { allowRequest, recordSuccess, recordFailure } from "./circuitBreaker.service.js";

const BASE_BACKOFF_MS = 300;

// Maps a provider name to the model it's configured to use, so the cache
// key (built from the PRIMARY provider's model) can be computed without
// actually calling anyone.
const PROVIDER_MODELS = {
  groq: env.GROQ_MODEL,
  gemini: env.GEMINI_MODEL,
  openrouter: env.OPENROUTER_MODEL,
};

function getProviderOrder() {
  return env.PROVIDER_ORDER.split(",").map((name) => name.trim());
}

// The model the gateway would use if nothing had failed - used to key the
// exact-match cache so a fallback answer still lands under the same entry.
export function getPrimaryModel() {
  const [primaryProvider] = getProviderOrder();
  return PROVIDER_MODELS[primaryProvider];
}

export function getPrimaryProvider() {
  return getProviderOrder()[0];
}

// A 429, a 5xx, or our own synthetic timeout (status 408) are worth retrying -
// they're usually transient. A 400 (bad request) or 401 (bad key) will fail
// the exact same way every time, so retrying would just waste time.
function isRetryable(error) {
  const status = error.status;
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

// Runs `callProvider(signal)` and rejects after `ms` if it hasn't settled -
// AND aborts it via the AbortController, so the real HTTP request actually
// stops instead of continuing in the background after we've given up on it.
function withTimeout(callProvider, ms) {
  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      const timeoutError = new Error(`Provider call timed out after ${ms}ms`);
      timeoutError.status = 408;
      reject(timeoutError);
    }, ms);

    callProvider(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function askWithFallback(prompt) {
  const attempts = [];

  for (const providerName of getProviderOrder()) {
    const providerFn = providers[providerName];
    if (!providerFn) {
      continue; // unknown name in PROVIDER_ORDER - nothing to call, skip it
    }

    const allowed = await allowRequest(providerName);
    if (!allowed) {
      continue; // circuit open, or another request already has the half-open test slot
    }

    for (let attempt = 0; attempt <= env.MAX_RETRIES; attempt++) {
      const attemptStart = Date.now();

      try {
        const result = await withTimeout(
          (signal) => providerFn(prompt, signal),
          env.PROVIDER_TIMEOUT_MS
        );

        attempts.push({
          provider: providerName,
          success: true,
          latencyMs: Date.now() - attemptStart,
        });

        await recordSuccess(providerName);
        return { ...result, provider: providerName, attempts };
      } catch (error) {
        attempts.push({
          provider: providerName,
          success: false,
          error: error.message,
          latencyMs: Date.now() - attemptStart,
        });

        const canRetry = isRetryable(error) && attempt < env.MAX_RETRIES;
        if (!canRetry) {
          break;
        }

        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }

    // Every attempt (including retries) for this provider failed.
    await recordFailure(providerName);
  }

  const error = new Error("All providers failed");
  error.attempts = attempts;
  throw error;
}

// Runs one streaming attempt against a single provider. Two different
// timeouts apply depending on whether any data has arrived yet:
//   - before the first chunk: PROVIDER_TIMEOUT_MS (same idea as the non-streaming path)
//   - after the first chunk: STREAM_IDLE_TIMEOUT_MS, reset on every new chunk
// Either timeout - or the external `clientSignal` firing (the HTTP client
// disconnected) - aborts the real request via the local AbortController.
function runStreamAttempt(providerFn, prompt, clientSignal, onDelta) {
  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    let settled = false;
    let gotFirstChunk = false;
    let idleTimer;

    function finish(action, value) {
      if (settled) return;
      settled = true;
      clearTimeout(firstChunkTimer);
      clearTimeout(idleTimer);
      clientSignal?.removeEventListener("abort", onClientAbort);
      action(value);
    }

    function armIdleTimer() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        controller.abort();
        const error = new Error(`No data received for ${env.STREAM_IDLE_TIMEOUT_MS}ms`);
        error.status = 408;
        finish(reject, error);
      }, env.STREAM_IDLE_TIMEOUT_MS);
    }

    function onClientAbort() {
      controller.abort();
      const error = new Error("Client disconnected");
      error.clientDisconnected = true;
      finish(reject, error);
    }

    if (clientSignal) {
      if (clientSignal.aborted) {
        onClientAbort();
        return;
      }
      clientSignal.addEventListener("abort", onClientAbort);
    }

    const firstChunkTimer = setTimeout(() => {
      controller.abort();
      const error = new Error(
        `Provider call timed out after ${env.PROVIDER_TIMEOUT_MS}ms waiting for the first chunk`
      );
      error.status = 408;
      finish(reject, error);
    }, env.PROVIDER_TIMEOUT_MS);

    providerFn(prompt, {
      signal: controller.signal,
      onDelta: (delta) => {
        if (settled) return;
        if (!gotFirstChunk) {
          gotFirstChunk = true;
          clearTimeout(firstChunkTimer);
        }
        armIdleTimer();
        onDelta(delta);
      },
    }).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}

// Streaming version of askWithFallback. Calls onDelta(text) for every piece
// of text as it arrives. Fallback and retries only happen BEFORE the first
// chunk has been forwarded to the caller (tracked by `firstChunkSent`) -
// once the client has started receiving an answer, switching providers would
// mean restarting mid-sentence, so any failure after that point is final.
export async function askWithFallbackStream(prompt, { onDelta, clientSignal }) {
  const attempts = [];
  let firstChunkSent = false;

  for (const providerName of getProviderOrder()) {
    const providerFn = streamingProviders[providerName];
    if (!providerFn) {
      continue; // no streaming support for this provider - skip it
    }

    const allowed = await allowRequest(providerName);
    if (!allowed) {
      continue; // circuit open, or another request already has the half-open test slot
    }

    for (let attempt = 0; attempt <= env.MAX_RETRIES; attempt++) {
      const attemptStart = Date.now();

      try {
        const result = await runStreamAttempt(providerFn, prompt, clientSignal, (delta) => {
          firstChunkSent = true;
          onDelta(delta);
        });

        attempts.push({
          provider: providerName,
          success: true,
          latencyMs: Date.now() - attemptStart,
        });

        await recordSuccess(providerName);
        return { ...result, provider: providerName, attempts };
      } catch (error) {
        attempts.push({
          provider: providerName,
          success: false,
          error: error.message,
          latencyMs: Date.now() - attemptStart,
        });

        if (error.clientDisconnected) {
          // Not the provider's fault - don't penalize its circuit breaker,
          // and there's no client left to retry or fall back for.
          error.attempts = attempts;
          throw error;
        }

        if (firstChunkSent) {
          // Already streaming an answer to the client - stop instead of switching.
          await recordFailure(providerName);
          error.attempts = attempts;
          throw error;
        }

        const canRetry = isRetryable(error) && attempt < env.MAX_RETRIES;
        if (!canRetry) {
          break;
        }

        await sleep(BASE_BACKOFF_MS * 2 ** attempt);
      }
    }

    await recordFailure(providerName);
  }

  const error = new Error("All providers failed");
  error.attempts = attempts;
  throw error;
}
