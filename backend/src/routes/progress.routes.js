const { Router } = require("express");
const {
  getProgress,
  getTrend,
  getErrors,
  getTajweed,
} = require("../controllers/progress.controller");
const { authenticate } = require("../middleware/auth.middleware");

const router = Router();

// All progress routes require authentication
router.use(authenticate);

// GET /api/progress
router.get("/", getProgress);

// GET /api/progress/trend
router.get("/trend", getTrend);

// GET /api/progress/errors
router.get("/errors", getErrors);

// GET /api/progress/tajweed
router.get("/tajweed", getTajweed);

module.exports = router;
