const { Router } = require("express");
const authRoutes     = require("./auth.routes");
const sessionRoutes  = require("./session.routes");
const progressRoutes = require("./progress.routes");
const quranRoutes    = require("./quran.routes");

const router = Router();

// Health check — no auth, used by load balancers / uptime monitors
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "True Tilawah API is running.",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Mount feature routers
router.use("/auth",     authRoutes);
router.use("/sessions", sessionRoutes);
router.use("/progress", progressRoutes);
router.use("/quran",    quranRoutes);

module.exports = router;
