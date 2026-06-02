const prisma = require("../models/prismaClient");

/**
 * Logs a single feedback entry (mistake) for a session.
 */
const createFeedback = async (sessionId, userId, feedbackData) => {
  // Verify the session belongs to this user
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    const err = new Error("Session not found.");
    err.statusCode = 404;
    throw err;
  }

  const feedback = await prisma.feedback.create({
    data: {
      sessionId,
      errorType: feedbackData.errorType,
      incorrectWord: feedbackData.incorrectWord,
      correctWord: feedbackData.correctWord,
      wordPosition: feedbackData.wordPosition || null,
      ayahNumber: feedbackData.ayahNumber || null,
      ruleApplied: feedbackData.ruleApplied || null,
      audioCorrectionUrl: feedbackData.audioCorrectionUrl || null,
      confidenceScore: feedbackData.confidenceScore || null,
      tajweedRuleId: feedbackData.tajweedRuleId || null,
    },
    include: { tajweedRule: true },
  });

  // Increment total mistakes in progress
  await prisma.progress.updateMany({
    where: { userId },
    data: { totalMistakes: { increment: 1 } },
  });

  return feedback;
};

/**
 * Bulk-insert multiple feedback entries (more efficient than one-by-one).
 */
const createFeedbackBatch = async (sessionId, userId, feedbackArray) => {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    const err = new Error("Session not found.");
    err.statusCode = 404;
    throw err;
  }

  const data = feedbackArray.map((f) => ({
    sessionId,
    errorType: f.errorType,
    incorrectWord: f.incorrectWord,
    correctWord: f.correctWord,
    wordPosition: f.wordPosition || null,
    ayahNumber: f.ayahNumber || null,
    ruleApplied: f.ruleApplied || null,
    audioCorrectionUrl: f.audioCorrectionUrl || null,
    confidenceScore: f.confidenceScore || null,
    tajweedRuleId: f.tajweedRuleId || null,
  }));

  await prisma.feedback.createMany({ data });

  // Increment total mistakes count
  await prisma.progress.updateMany({
    where: { userId },
    data: { totalMistakes: { increment: feedbackArray.length } },
  });

  return { inserted: feedbackArray.length };
};

/**
 * Returns all feedback entries for a given session.
 */
const getSessionFeedback = async (sessionId, userId) => {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    const err = new Error("Session not found.");
    err.statusCode = 404;
    throw err;
  }

  return prisma.feedback.findMany({
    where: { sessionId },
    include: { tajweedRule: true },
    orderBy: { createdAt: "asc" },
  });
};

/**
 * Returns all Tajweed rules stored in the database (reference data).
 */
const getAllTajweedRules = async () => {
  return prisma.tajweedRule.findMany({ orderBy: { ruleName: "asc" } });
};

/**
 * Marks a single feedback row as disputed by the owning user.
 * Disputed rows are excluded from Progress.totalMistakes aggregation.
 */
const disputeFeedback = async (feedbackId, userId) => {
  // Verify ownership via session join
  const fb = await prisma.feedback.findFirst({
    where: { id: feedbackId, session: { userId } },
  });
  if (!fb) {
    const err = new Error("Feedback not found.");
    err.statusCode = 404;
    throw err;
  }
  return prisma.feedback.update({
    where: { id: feedbackId },
    data: { disputed: true },
  });
};

module.exports = {
  createFeedback,
  createFeedbackBatch,
  getSessionFeedback,
  getAllTajweedRules,
  disputeFeedback,
};
