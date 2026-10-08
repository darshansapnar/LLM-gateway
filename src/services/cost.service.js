// Converts token counts into a USD cost estimate using pricing.js.
import { pricing } from "../config/pricing.js";

export function calculateCost(model, inputTokens, outputTokens) {
  // OpenRouter's free-tier models are suffixed ":free" (e.g.
  // "meta-llama/llama-3.1-8b-instruct:free") and are always $0 - there's no
  // real price to look up, and warning about a "missing" entry would be wrong.
  if (model.endsWith(":free")) {
    return 0;
  }

  const rates = pricing[model];

  if (!rates) {
    console.warn(
      `No pricing entry for model "${model}" - costUsd will be 0. Add it to src/config/pricing.js.`
    );
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * rates.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPerMillion;

  return inputCost + outputCost;
}
