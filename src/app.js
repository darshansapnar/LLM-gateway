// Sets up the Express application: middleware and routes.
// This file does NOT start the server - src/index.js does that.
// Keeping them separate makes it easy to test the app later
// without actually opening a network port.
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { cookieParser } from "./middleware/cookieParser.js";
import healthRoutes from "./routes/health.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import demoRoutes from "./routes/demo.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Trust reverse proxy (e.g. Nginx, Fly, Render) to get the real client IP for rate limiting
if (env.TRUST_PROXY) {
  app.set("trust proxy", true);
}

// Lets the dashboard's browser (running on DASHBOARD_ORIGIN) call this API.
// credentials: true allows httpOnly cookies (such as visitorId) across origins.
app.use(
  cors({
    origin: env.DASHBOARD_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-key", "x-cache-bypass"],
    exposedHeaders: [
      "X-Cache",
      "X-Provider",
      "X-Semantic-Cache",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "Retry-After",
      "X-Request-Id",
      "X-PII-Redacted",
      "X-PII-Mode",
    ],
  })
);

// Parses incoming cookies
app.use(cookieParser);

// Parses incoming JSON request bodies into req.body with a strict size limit
app.use(express.json({ limit: "50kb" }));

// Serves static files (e.g. public/stream-test.html) directly, no route needed.
app.use(express.static(path.join(__dirname, "..", "public")));

// Mount routes
app.use(healthRoutes);
app.use(demoRoutes);
app.use(chatRoutes);
app.use(adminRoutes);

// Error handler: never leak stack traces in production
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === "production";
  res.status(status).json({
    error: err.message || "Internal Server Error",
    ...(isProd ? {} : { stack: err.stack }),
  });
});

export default app;
