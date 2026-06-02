const {
  createFeedback,
  createFeedbackBatch,
  getSessionFeedback,
  getAllTajweedRules,
  disputeFeedback,
} = require("../services/feedback.service");
const { sendSuccess, sendError } = require("../utils/response.util");

/**
 * POST /api/sessions/:sessionId/feedback
 * Logs a single mistake entry.
 */
const logFeedback = async (req, res, next) => {
  try {
    const feedback = await createFeedback(
      req.params.sessionId,
      req.user.id,
      req.body
    );
    return sendSuccess(res, 201, "Feedback logged.", feedback);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/sessions/:sessionId/feedback/batch
 * Bulk-logs multiple mistake entries in one request.
 */
const logFeedbackBatch = async (req, res, next) => {
  try {
    const { feedbacks } = req.body;
    if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
      return sendError(res, 400, "feedbacks must be a non-empty array.");
    }
    const result = await createFeedbackBatch(
      req.params.sessionId,
      req.user.id,
      feedbacks
    );
    return sendSuccess(res, 201, "Feedback batch logged.", result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sessions/:sessionId/feedback
 */
const listFeedback = async (req, res, next) => {
  try {
    const feedbacks = await getSessionFeedback(
      req.params.sessionId,
      req.user.id
    );
    return sendSuccess(res, 200, "Feedback fetched.", feedbacks);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/tajweed-rules
 * Public — returns the Tajweed rule reference table.
 */
const listTajweedRules = async (req, res, next) => {
  try {
    const rules = await getAllTajweedRules();
    return sendSuccess(res, 200, "Tajweed rules fetched.", rules);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/sessions/:sessionId/feedback/:feedbackId/dispute
 * Marks a feedback row as disputed (false-positive flow).
 */
const dispute = async (req, res, next) => {
  try {
    const fb = await disputeFeedback(req.params.feedbackId, req.user.id);
    return sendSuccess(res, 200, "Feedback disputed.", fb);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  logFeedback,
  logFeedbackBatch,
  listFeedback,
  listTajweedRules,
  dispute,
};
