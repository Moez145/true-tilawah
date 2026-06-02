const { Router } = require("express");
const {
  create,
  list,
  getOne,
  complete,
  abandon,
  remove,
} = require("../controllers/session.controller");
const {
  logFeedback,
  logFeedbackBatch,
  listFeedback,
  dispute,
} = require("../controllers/feedback.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const {
  createSessionValidator,
  completeSessionValidator,
  listSessionValidator,
} = require("./validators/session.validator");
const { feedbackValidator } = require("./validators/feedback.validator");

const router = Router();

// All session routes require authentication
router.use(authenticate);

// ── Session CRUD ──────────────────────────────────────────────
// POST   /api/sessions
router.post("/", createSessionValidator, validate, create);

// GET    /api/sessions
router.get("/", listSessionValidator, validate, list);

// GET    /api/sessions/:id
router.get("/:id", getOne);

// PATCH  /api/sessions/:id/complete
router.patch("/:id/complete", completeSessionValidator, validate, complete);

// PATCH  /api/sessions/:id/abandon
router.patch("/:id/abandon", abandon);

// DELETE /api/sessions/:id
router.delete("/:id", remove);

// ── Nested Feedback ───────────────────────────────────────────
// POST   /api/sessions/:sessionId/feedback
router.post("/:sessionId/feedback", feedbackValidator, validate, logFeedback);

// POST   /api/sessions/:sessionId/feedback/batch
router.post("/:sessionId/feedback/batch", logFeedbackBatch);

// GET    /api/sessions/:sessionId/feedback
router.get("/:sessionId/feedback", listFeedback);

// PATCH  /api/sessions/:sessionId/feedback/:feedbackId/dispute
router.patch("/:sessionId/feedback/:feedbackId/dispute", dispute);

module.exports = router;
