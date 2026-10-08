// Sets up the Express application: middleware and routes.
// This file does NOT start the server - src/index.js does that.
// Keeping them separate makes it easy to test the app later
// without actually opening a network port.
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import healthRoutes from "./routes/health.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Lets the dashboard's browser (running on a different origin - a different
// port counts) call this API. Browsers block cross-origin requests by
// default; without this, the dashboard's fetch() calls would be rejected
// before they even reached our routes. x-admin-key has to be explicitly
// allowed since it's a custom header, not one browsers send automatically.
app.use(
  cors({
    origin: env.DASHBOARD_ORIGIN,
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-key", "x-cache-bypass"],
    // By default a browser can only read the handful of CORS-safelisted
    // response headers (Content-Type among them) - everything else is
    // invisible to fetch()/XHR unless explicitly exposed here. The
    // Playground page (dashboard/src/pages/Playground.jsx) reads these to
    // show cache/provider/rate-limit info without duplicating it into the
    // JSON body.
    exposedHeaders: [
      "X-Cache",
      "X-Provider",
      "X-Semantic-Cache",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "Retry-After",
      "X-Request-Id",
    ],
  })
);

// Parses incoming JSON request bodies into req.body
app.use(express.json());

// Serves static files (e.g. public/stream-test.html) directly, no route needed.
app.use(express.static(path.join(__dirname, "..", "public")));

// Mount routes
app.use(healthRoutes);
app.use(chatRoutes);
app.use(adminRoutes);

export default app;
