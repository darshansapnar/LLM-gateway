// Routes related to checking whether the server is alive and healthy
import { Router } from "express";

const router = Router();

// GET /health - a simple endpoint to confirm the server is running.
// Tools like uptime monitors and load balancers call endpoints like
// this to check if the app is still alive.
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(), // seconds since the process started
    timestamp: new Date().toISOString(),
  });
});

export default router;
