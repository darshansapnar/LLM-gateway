# --- deps stage: install production-only dependencies -----------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime stage: the actual image that runs the server --------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# The node:alpine base image already ships a non-root "node" user
# (uid 1000) - reuse it instead of creating a new one.
USER node

EXPOSE 3000

# Hits the app's own GET /health - fails the check (and lets Docker/Compose
# mark the container unhealthy) if the server stops responding.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT}/health" || exit 1

CMD ["node", "src/index.js"]
