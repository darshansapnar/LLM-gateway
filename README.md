# LLM Gateway

A middleware server between apps and AI providers (Groq, Gemini). Handles caching (exact +
semantic), rate limiting, provider fallback, streaming, cost tracking, and ships with a React
dashboard for monitoring and managing API keys.

See [`CLAUDE.md`](./CLAUDE.md) for the full technical write-up of how each piece works.

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

## Project structure

See the "Folder structure" section in [`CLAUDE.md`](./CLAUDE.md) for a full file-by-file map of
`src/`, `dashboard/`, `scripts/`, and the Docker files.
