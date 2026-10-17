# LLM Gateway

[![CI](https://github.com/darshansapnar/LLM-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/darshansapnar/LLM-gateway/actions/workflows/ci.yml)

A middleware server between apps and AI providers (Groq, Gemini). Features:

- Caching (exact-match + semantic/meaning-based, with a verification pipeline to avoid wrong hits)
- Rate limiting and provider fallback (Groq → Gemini)
- Streaming (Server-Sent Events)
- Cost tracking
- **PII redaction** - detects emails, phone numbers, card numbers, Aadhaar, PAN, and API keys/secrets in prompts, masks them before they reach the provider or any cache/database, and restores the real values only for the original caller. See [`docs/pii-redaction.md`](./docs/pii-redaction.md).
- A React dashboard for monitoring and managing API keys
- **Public Demo Mode** - Keyless demo chat and public dashboard metrics with per-IP rate limiting, daily budget, and visitor privacy isolation.

See [`CLAUDE.md`](./CLAUDE.md) for the full technical write-up of how each piece works.

## Live Demo

Experience the gateway in action without an API key or local setup:

- **Live Dashboard & Playground**: `https://demo.llm-gateway.example.com` *(Placeholder URL)*
- **Public Chat Endpoint**: `POST https://demo.llm-gateway.example.com/demo/chat`

The public demo mode includes:
- **Keyless Playground**: Immediate testing with ready-made demo prompt chips (PII masking, exact cache hit, semantic cache hit, guard rejection, provider fallback).
- **Safe by Default**: PII masking is permanently enforced on demo calls.
- **Fair Use Budgets**: 20 requests/hour per IP, 300 requests/day global budget, 500 chars max prompt, 300 max output tokens.
- **Visitor Privacy**: 24-hour anonymous visitor cookie (`visitorId`). Prompt and response text are only visible to the visitor who submitted them; raw client IPs are hashed with SHA-256 and never stored.
- **Admin Lockout**: Admin tabs (`Requests`, `Providers`, `Cache`, `API Keys`) require signing in with an admin key.

## Run locally (without Docker)

Requires Node.js, a MongoDB instance, and a Redis instance with the RediSearch module (needed
for semantic caching's vector index - e.g. `redis-stack-server`, not plain `redis`).

```bash
npm install
cp .env.example .env     # fill in MONGO_URI, REDIS_URL, GROQ_API_KEY, GEMINI_API_KEY, ADMIN_API_KEY
npm run dev               # backend - http://localhost:3000

npm run install:dashboard # once
npm run dev:dashboard     # dashboard - http://localhost:5173
```

Create an API key for calling `/v1/chat`:

```bash
npm run create-key -- my-app              # or: npm run create-key -- my-app --semantic
```

## Run with Docker

Requires Docker and Docker Compose. This runs the gateway, dashboard, MongoDB, and Redis
(with the RediSearch module) all together - no local Mongo/Redis/Node install needed.

```bash
cp .env.docker.example .env
# edit .env: set GROQ_API_KEY, GEMINI_API_KEY, and ADMIN_API_KEY (generate a real random value)

npm run docker:up         # builds the images and starts everything in the background
```

- Dashboard: http://localhost:5173 - log in with the `ADMIN_API_KEY` you put in `.env`.
- Gateway API: http://localhost:3000
- Health check: http://localhost:3000/health

**Check everything is healthy:**

```bash
docker compose ps          # mongo/redis/gateway should all show "healthy"; dashboard "running" (nginx has no built-in health status in `ps`, use the HEALTHCHECK below or just open it in a browser)
curl http://localhost:3000/health
```

**Create an API key inside the running container:**

```bash
docker compose exec gateway node scripts/createApiKey.js my-app
# or, with semantic caching enabled for this key:
docker compose exec gateway node scripts/createApiKey.js my-app --semantic
```

Copy the printed key immediately - like the dashboard's "Create API key" button, it's shown
exactly once and only its hash is ever stored (see `CLAUDE.md`'s "API key creation" section for
why).

**View logs / stop:**

```bash
npm run docker:logs
npm run docker:down        # stops and removes the containers (data survives in volumes)
docker compose down -v     # stops AND deletes the mongo/redis volumes - starts fully fresh next time
```

## Automated Tests & Linting

The test suite runs with Node's native test runner (`node:test` + `node:assert/strict`) and in-process provider mocks—no live AI API keys are ever required or contacted during testing. Tests run against an isolated test MongoDB database (`llm-gateway-test`) and Redis DB index (`1`).

```bash
npm run lint              # Run ESLint across src/, tests/, and scripts/
npm run test:unit         # Run fast unit tests (cache verifier, circuit breaker, retry/backoff, cost, PII)
npm run test:integration  # Run integration tests (Redis index bootstrap, auth, rate limit, caches, fallback, streaming, admin)
npm test                  # Run complete test suite (unit + integration + PII route)
npm run test:coverage     # Run all tests with code coverage report
```

## Project structure

See the "Folder structure" section in [`CLAUDE.md`](./CLAUDE.md) for a full file-by-file map of
`src/`, `dashboard/`, `scripts/`, and the Docker files.

