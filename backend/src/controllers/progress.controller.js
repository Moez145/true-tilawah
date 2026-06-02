const {
  getUserProgress,
  getAccuracyTrend,
  getErrorSummary,
  getTajweedViolations,
} = require("../services/progress.service");
const { sendSuccess } = require("../utils/response.util");

/**
 * GET /api/progress
 */
const getProgress = async (req, res, next) => {
  try {
    const progress = await getUserProgress(req.user.id);
    return sendSuccess(res, 200, "Progress fetched.", progress);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/progress/trend?limit=10
 */
const getTrend = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const trend = await getAccuracyTrend(req.user.id, limit);
    return sendSuccess(res, 200, "Accuracy trend fetched.", trend);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/progress/errors
 */
const getErrors = async (req, res, next) => {
  try {
    const summary = await getErrorSummary(req.user.id);
    return sendSuccess(res, 200, "Error summary fetched.", summary);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/progress/tajweed
 */
const getTajweed = async (req, res, next) => {
  try {
    const violations = await getTajweedViolations(req.user.id);
    return sendSuccess(res, 200, "Tajweed violations fetched.", violations);
  } catch (error) {
    next(error);
  }
};

module.exports = { getProgress, getTrend, getErrors, getTajweed };
