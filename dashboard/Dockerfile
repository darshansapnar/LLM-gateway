# --- build stage: compile the Vite app to static files -----------------
FROM node:22-alpine AS build
WORKDIR /app

# Vite bakes VITE_* vars into the built JS at build time (not read at
# container start), so it has to come in as a build arg, not a runtime env
# var - see dashboard/.env.example's comment on the same point.
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime stage: serve the built files with nginx --------------------
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
