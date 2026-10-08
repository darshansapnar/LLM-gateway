// Converts text into an embedding vector (a list of floats that represents
// its meaning) using Gemini's embedding model. Used by semanticCache.service.js
// to find prompts that mean the same thing, even if worded differently.
import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";

// Built lazily, same reasoning as gemini.service.js - don't touch the API
// key at import time, only when embedding is actually attempted.
let ai;

function getClient() {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return ai;
}

// L2-normalizes a vector (scales it to length 1). Per Google's docs, only
// gemini-embedding-001's native 3072-dim output is pre-normalized by the
// API - any truncated output (our 768-dim EMBEDDING_DIM included) comes
// back with a magnitude that drifts per input, which distorts cosine
// similarity/distance math downstream. We normalize once here so every
// consumer (cache storage, cache lookup, the eval script) always works
// with comparable, unit-length vectors.
function normalize(values) {
  const magnitude = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  return magnitude === 0 ? values : values.map((v) => v / magnitude);
}

// Returns a normalized float array, or null if embedding failed for any
// reason. Callers MUST treat null as "skip semantic caching for this
// request" - an embedding failure should never break the actual chat request.
export async function embed(text) {
  try {
    const response = await getClient().models.embedContent({
      model: env.EMBEDDING_MODEL,
      contents: text,
      config: {
        outputDimensionality: env.EMBEDDING_DIM,
        // SEMANTIC_SIMILARITY is the task type Google's docs recommend for
        // "how similar in meaning are these two texts" comparisons - other
        // task types (e.g. RETRIEVAL_QUERY/RETRIEVAL_DOCUMENT) optimize the
        // embedding space asymmetrically for search, not direct comparison.
        taskType: "SEMANTIC_SIMILARITY",
      },
    });

    return normalize(response.embeddings[0].values);
  } catch (error) {
    console.error("Embedding failed, skipping semantic cache for this request:", error.message);
    return null;
  }
}
