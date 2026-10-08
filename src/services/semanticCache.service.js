// Semantic caching: finds a previously-answered prompt with a SIMILAR
// meaning (not necessarily the same words) using a Redis vector index over
// Gemini embeddings. Every function here fails soft - any Redis/search
// problem just means "no semantic cache match", never a broken request.
import crypto from "crypto";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";

const INDEX_NAME = "idx:cache:sem";
const KEY_PREFIX = "cache:sem:";

function toVectorBuffer(values) {
  return Buffer.from(new Float32Array(values).buffer);
}

// RediSearch TAG queries treat most punctuation as special syntax - escape
// every non-alphanumeric character so a model name like "openai/gpt-oss-120b"
// is matched literally instead of breaking the query.
function escapeTagValue(value) {
  return value.replace(/[^a-zA-Z0-9]/g, "\\$&");
}

// Turns RediSearch's flat [key, value, key, value, ...] reply shape into a
// plain object. FT.SEARCH nests several of these inside each other.
function arrayToObject(flatArray) {
  const obj = {};
  for (let i = 0; i < flatArray.length; i += 2) {
    obj[flatArray[i]] = flatArray[i + 1];
  }
  return obj;
}

// Creates the vector index once, at startup, if it doesn't already exist.
// Existence is checked with FT._LIST (the actual list of index names)
// instead of inspecting FT.INFO's error text on a missing index - that
// wording isn't stable across RediSearch versions/images (this project has
// seen both "...not found..." and "Unknown index name"), so matching a
// specific substring is fragile and silently breaks on a fresh Redis that
// returns different wording - exactly what happened the first time this
// ran against a brand new redis-stack-server container instead of a
// long-lived dev Redis that already had the index.
export async function ensureSemanticIndex() {
  const indexes = await redis.call("FT._LIST");
  if (indexes.includes(INDEX_NAME)) {
    return; // already exists
  }

  try {
    await redis.call(
      "FT.CREATE",
      INDEX_NAME,
      "ON",
      "HASH",
      "PREFIX",
      "1",
      KEY_PREFIX,
      "SCHEMA",
      "embedding",
      "VECTOR",
      "HNSW",
      "6",
      "TYPE",
      "FLOAT32",
      "DIM",
      String(env.EMBEDDING_DIM),
      "DISTANCE_METRIC",
      "COSINE",
      "model",
      "TAG",
      "prompt",
      "TEXT",
      "createdAt",
      "NUMERIC"
    );
    console.log(`Created Redis vector index "${INDEX_NAME}"`);
  } catch (error) {
    // Another gateway instance can win the race and create the index
    // between our FT._LIST check and this FT.CREATE call (e.g. two
    // containers/replicas starting at the same moment) - that's fine, the
    // index exists either way, so this one specific error is not fatal.
    // Anything else is a real, unexpected problem and should stop startup
    // loudly rather than leave semantic caching silently broken.
    if (String(error.message).toLowerCase().includes("already exists")) {
      return;
    }
    console.error(`Failed to create Redis vector index "${INDEX_NAME}":`, error.message);
    throw error;
  }
}

// Deletes every stored semantic cache entry and drops+recreates the index.
// Needed whenever the embedding itself changes shape (model, dimension,
// task type, normalization) - old vectors computed a different way are not
// comparable to new ones, so they have to go rather than linger as silently
// wrong matches. Not called automatically; run it by hand after a change
// like that (see scripts/clearSemanticCache.js).
export async function clearSemanticCache() {
  const keys = await redis.keys(`${KEY_PREFIX}*`);
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  await redis.call("FT.DROPINDEX", INDEX_NAME).catch(() => {}); // ignore "doesn't exist"
  await ensureSemanticIndex();

  return keys.length;
}

// Looks for the single closest-meaning prompt previously cached under the
// same model. Returns null if nothing is close enough (< SIMILARITY_THRESHOLD)
// or if the search itself fails for any reason.
export async function findSimilar(model, embedding) {
  try {
    const query = `(@model:{${escapeTagValue(model)}})=>[KNN 1 @embedding $vec AS score]`;

    const raw = await redis.call(
      "FT.SEARCH",
      INDEX_NAME,
      query,
      "PARAMS",
      "2",
      "vec",
      toVectorBuffer(embedding),
      "SORTBY",
      "score",
      "DIALECT",
      "2"
    );

    const top = arrayToObject(raw);
    const results = top.results;
    if (!results || results.length === 0) {
      return null;
    }

    const first = arrayToObject(results[0]);
    const fields = arrayToObject(first.extra_attributes || []);

    const distance = Number(fields.score);
    const similarity = 1 - distance;

    if (similarity < env.SIMILARITY_THRESHOLD) {
      return null;
    }

    return {
      key: first.id,
      similarity,
      prompt: fields.prompt,
      data: JSON.parse(fields.data),
    };
  } catch (error) {
    console.error("Semantic cache lookup failed, continuing without it:", error.message);
    return null;
  }
}

// Deletes one specific semantic cache entry by its Redis key (as returned
// by findSimilar's `key` field). Used for "regenerate eviction": a
// bypassed, regenerated answer tells us the entry that WOULD have matched
// was wrong, so it should stop being served to anyone else.
export async function evictEntry(key) {
  try {
    await redis.del(key);
  } catch (error) {
    console.error("Semantic cache eviction failed (non-fatal):", error.message);
  }
}

// Stores a prompt + its answer under a fresh key, keyed by its embedding.
export async function store(model, prompt, embedding, data) {
  try {
    const key = `${KEY_PREFIX}${crypto.randomUUID()}`;

    await redis.call(
      "HSET",
      key,
      "embedding",
      toVectorBuffer(embedding),
      "model",
      model,
      "prompt",
      prompt,
      "data",
      JSON.stringify(data),
      "createdAt",
      String(Date.now())
    );
    await redis.expire(key, env.CACHE_TTL_SECONDS);
  } catch (error) {
    console.error("Semantic cache store failed (non-fatal):", error.message);
  }
}
