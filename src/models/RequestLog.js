// Defines what a "request log" document looks like in MongoDB.
// Every call to /v1/chat creates one of these, whether it succeeded or failed,
// so we have a full history of traffic through the gateway.
import mongoose from "mongoose";

const requestLogSchema = new mongoose.Schema({
  apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", required: true },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  prompt: { type: String, required: true },
  response: { type: String },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  latencyMs: { type: Number, required: true },
  status: { type: String, enum: ["success", "error", "cancelled"], required: true },
  errorMessage: { type: String },
  cacheHit: { type: Boolean, default: false },
  cacheType: { type: String, enum: ["exact", "semantic", "none"], default: "none" },
  similarity: { type: Number, default: null },
  matchedPrompt: { type: String, default: null },
  // What the antonym guard / LLM judge decided about a semantic candidate,
  // e.g. "antonym: lock/unlock", "judge: NO", "accepted". Null when no
  // semantic candidate was ever found (exact hit, or embeddings found nothing).
  verifierResult: { type: String, default: null },
  // Stable classification of the same decision, for stats aggregation -
  // verifierResult is free text for humans, this is the machine-readable version.
  verifierOutcome: {
    type: String,
    enum: ["rejected_by_guard", "accepted_high_similarity", "accepted_by_judge", "rejected_by_judge", null],
    default: null,
  },
  judgeUsed: { type: Boolean, default: false },
  judgeInputTokens: { type: Number, default: 0 },
  judgeOutputTokens: { type: Number, default: 0 },
  judgeCostUsd: { type: Number, default: 0 },
  judgeLatencyMs: { type: Number, default: 0 },
  tokensSaved: { type: Number, default: 0 },
  costUsd: { type: Number, default: 0 },
  costSavedUsd: { type: Number, default: 0 },
  fallbackUsed: { type: Boolean, default: false },
  stream: { type: Boolean, default: false },
  ttftMs: { type: Number, default: null },
  attempts: [
    {
      _id: false,
      provider: String,
      success: Boolean,
      error: String,
      latencyMs: Number,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

export const RequestLog = mongoose.model("RequestLog", requestLogSchema);
