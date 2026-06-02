const express = require("express");
const cors    = require("cors");
const helmet  = require("helmet");
const morgan  = require("morgan");
const rateLimit = require("express-rate-limit");
const expressWs = require("express-ws");

const routes = require("./routes/index");
const {
  prismaErrorHandler,
  globalErrorHandler,
  notFoundHandler,
} = require("./middleware/error.middleware");
const { registerAudioWebSocket } = require("./routes/audio.ws");

const app = express();
const path = require('path');
app.use('/audio', express.static(path.join(__dirname, '../public/audio')));

// Enable WS support BEFORE any middleware is registered. express-ws routes
// upgrade requests through the normal Express middleware chain, so the WS
// route MUST be registered before notFoundHandler — otherwise the 404 handler
// short-circuits the WS upgrade and silently closes the socket (no log, no
// close code) before reaching the handler. See express-ws/lib/index.js:81.
expressWs(app);

// ─────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────
app.use(helmet());

// ─────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─────────────────────────────────────────────
// Request logging (skip in test env)
// ─────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
}

// ─────────────────────────────────────────────
// Body parsing
// ─────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));       // JSON payloads
app.use(express.urlencoded({ extended: true })); // form-encoded

// ─────────────────────────────────────────────
// Global rate limiter
// ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please slow down and try again later.",
  },
});
app.use("/api", limiter);

// ─────────────────────────────────────────────
// API routes — all prefixed with /api
// ─────────────────────────────────────────────
app.use("/api", routes);

// ─────────────────────────────────────────────
// WebSocket routes — MUST be before notFoundHandler so WS upgrades
// don't fall through to the 404 handler.
// ─────────────────────────────────────────────
registerAudioWebSocket(app);

// ─────────────────────────────────────────────
// 404 — must be after all real routes (HTTP and WS)
// ─────────────────────────────────────────────
app.use(notFoundHandler);

// ─────────────────────────────────────────────
// Error handlers — must be last, in this order
// ─────────────────────────────────────────────
app.use(prismaErrorHandler);
app.use(globalErrorHandler);

module.exports = app;
