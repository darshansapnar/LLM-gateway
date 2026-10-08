// Talks to the Gemini API and returns a plain, normalized result.
// Keeping this isolated means the rest of the app never needs to know
// which provider SDK or response shape is behind it.
import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";

// Built lazily, on first actual use - not at import time. GEMINI_API_KEY is
// only required when "gemini" is in PROVIDER_ORDER (see env.js), so
// constructing this eagerly would warn/fail every startup even when Gemini
// is never called.
let ai;

function getClient() {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return ai;
}

// Sends a prompt to Gemini and returns the generated text plus token usage.
// `signal` lets the caller (router.service.js) actually cancel the HTTP
// request once PROVIDER_TIMEOUT_MS elapses, instead of just stopping its wait.
export async function askGemini(prompt, signal) {
  const result = await getClient().models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: { abortSignal: signal },
  });

  const usage = result.usageMetadata ?? {};

  return {
    text: result.text,
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    model: env.GEMINI_MODEL,
  };
}

// Streams a prompt to Gemini, calling onDelta with each text piece as it
// arrives. Resolves with the same shape as askGemini once the stream ends.
// Each chunk carries its own usageMetadata; the last chunk's is the final,
// complete count, so we just keep overwriting as chunks arrive.
export async function askGeminiStream(prompt, { signal, onDelta }) {
  const stream = await getClient().models.generateContentStream({
    model: env.GEMINI_MODEL,
    contents: prompt,
    config: { abortSignal: signal },
  });

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.text;
    if (delta) {
      text += delta;
      onDelta(delta);
    }

    if (chunk.usageMetadata) {
      inputTokens = chunk.usageMetadata.promptTokenCount ?? 0;
      outputTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
    }
  }

  return { text, inputTokens, outputTokens, model: env.GEMINI_MODEL };
}
