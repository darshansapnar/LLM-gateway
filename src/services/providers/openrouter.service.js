// Talks to OpenRouter (an OpenAI-compatible chat completions API) and
// returns a plain, normalized result - same shape as the other providers.
// No SDK needed: Node's built-in fetch is enough for one REST call.
import { env } from "../../config/env.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function askOpenRouter(prompt, signal) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL,
      messages: [{ role: "user", content: prompt }],
    }),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const error = new Error(`OpenRouter request failed (${response.status}): ${errorBody}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const usage = data.usage ?? {};

  return {
    text: data.choices[0].message.content,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    model: env.OPENROUTER_MODEL,
  };
}
