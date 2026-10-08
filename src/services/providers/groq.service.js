// Talks to the Groq API and returns a plain, normalized result.
// Same shape as gemini.service.js so the rest of the app doesn't care
// which provider is actually answering the prompt.
import Groq from "groq-sdk";
import { env } from "../../config/env.js";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

// Sends a prompt to Groq and returns the generated text plus token usage.
// `signal` lets the caller (router.service.js) actually cancel the HTTP
// request once PROVIDER_TIMEOUT_MS elapses, instead of just stopping its wait.
export async function askGroq(prompt, signal) {
  const completion = await groq.chat.completions.create(
    {
      model: env.GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
    },
    { signal }
  );

  const usage = completion.usage ?? {};

  return {
    text: completion.choices[0].message.content,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    model: env.GROQ_MODEL,
  };
}

// Streams a prompt to Groq, calling onDelta with each text piece as it
// arrives. Resolves with the same shape as askGroq once the stream ends.
// Groq only sends token usage on the final chunk, under `x_groq.usage`.
export async function askGroqStream(prompt, { signal, onDelta }) {
  const stream = await groq.chat.completions.create(
    {
      model: env.GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    },
    { signal }
  );

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      text += delta;
      onDelta(delta);
    }

    if (chunk.x_groq?.usage) {
      inputTokens = chunk.x_groq.usage.prompt_tokens ?? 0;
      outputTokens = chunk.x_groq.usage.completion_tokens ?? 0;
    }
  }

  return { text, inputTokens, outputTokens, model: env.GROQ_MODEL };
}
