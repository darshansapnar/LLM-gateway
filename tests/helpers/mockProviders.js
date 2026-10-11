// Helper for mocking Groq, Gemini, OpenRouter, and Gemini Embeddings.
// Mutates the providers / streamingProviders registry in-place so router.service.js
// and cacheVerifier.service.js use the mock without needing external mocking libraries.
import { providers, streamingProviders } from "../../src/services/providers/index.js";
import { setMockEmbed, resetMockEmbed } from "../../src/services/embedding.service.js";
import { env } from "../../src/config/env.js";

// Preserve references to original implementations
const originalProviders = { ...providers };
const originalStreamingProviders = { ...streamingProviders };

export function mockProviderSuccess(providerName, text = "Mocked AI answer", options = {}) {
  const calls = [];
  const model = options.model || (providerName === "gemini" ? env.GEMINI_MODEL : env.GROQ_MODEL);
  const inputTokens = options.inputTokens ?? 10;
  const outputTokens = options.outputTokens ?? 20;

  providers[providerName] = async (prompt, signal) => {
    calls.push({ prompt, signal });
    return {
      text,
      inputTokens,
      outputTokens,
      model,
    };
  };

  return calls;
}

export function mockProviderError(providerName, status = 500, message = "Mock provider failure") {
  const calls = [];
  providers[providerName] = async (prompt, signal) => {
    calls.push({ prompt, signal });
    const err = new Error(message);
    err.status = status;
    throw err;
  };
  return calls;
}

export function mockProviderTimeout(providerName, delayMs = 20000) {
  const calls = [];
  providers[providerName] = async (prompt, signal) => {
    calls.push({ prompt, signal });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve({ text: "Late response", inputTokens: 5, outputTokens: 5, model: "timeout-test" });
      }, delayMs);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const abortErr = new Error("Aborted");
        abortErr.name = "AbortError";
        reject(abortErr);
      });
    });
  };
  return calls;
}

export function mockProviderStream(providerName, deltas = ["Hello", " world"], options = {}) {
  const calls = [];
  const model = options.model || (providerName === "gemini" ? env.GEMINI_MODEL : env.GROQ_MODEL);
  const inputTokens = options.inputTokens ?? 5;
  const outputTokens = options.outputTokens ?? 10;

  streamingProviders[providerName] = async (prompt, { signal, onDelta }) => {
    calls.push({ prompt, signal });
    let text = "";
    for (const delta of deltas) {
      if (signal?.aborted) {
        throw new Error("Stream aborted");
      }
      onDelta(delta);
      text += delta;
    }
    return { text, inputTokens, outputTokens, model };
  };

  return calls;
}

// Generate a deterministic unit-length 768-dim vector
export function createDeterministicVector(seed = 1) {
  const values = new Array(768).fill(0).map((_, i) => Math.sin(seed + i));
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return values.map((v) => v / magnitude);
}

export function mockEmbeddingSuccess(vectorOrFn) {
  if (typeof vectorOrFn === "function") {
    setMockEmbed(vectorOrFn);
  } else {
    const vector = vectorOrFn || createDeterministicVector(1);
    setMockEmbed(async () => vector);
  }
}

export function mockEmbeddingFailure(errorMessage = "Embedding API quota exceeded") {
  setMockEmbed(async () => {
    console.error(`Mock embedding error: ${errorMessage}`);
    return null;
  });
}

export function resetAllMocks() {
  Object.assign(providers, originalProviders);
  Object.assign(streamingProviders, originalStreamingProviders);
  resetMockEmbed();
}
