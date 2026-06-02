const prisma = require("../models/prismaClient");

/**
 * Returns the authenticated user's full progress record.
 */
const getUserProgress = async (userId) => {
  const progress = await prisma.progress.findUnique({
    where: { userId },
  });

  if (!progress) {
    const err = new Error("Progress record not found.");
    err.statusCode = 404;
    throw err;
  }

  return progress;
};

/**
 * Returns the last N sessions with accuracy scores (for trend charts).
 */
const getAccuracyTrend = async (userId, limit = 10) => {
  const sessions = await prisma.session.findMany({
    where: { userId, status: "COMPLETED" },
    select: {
      id: true,
      accuracyScore: true,
      startTime: true,
      durationSec: true,
      quranicText: { select: { surahName: true } },
    },
    orderBy: { startTime: "desc" },
    take: limit,
  });

  return sessions.reverse(); // Chronological order for frontend charts
};

/**
 * Returns the most common error types for this user (aggregated).
 */
const getErrorSummary = async (userId) => {
  const errors = await prisma.feedback.groupBy({
    by: ["errorType"],
    where: { session: { userId } },
    _count: { errorType: true },
    orderBy: { _count: { errorType: "desc" } },
  });

  return errors.map((e) => ({
    errorType: e.errorType,
    count: e._count.errorType,
  }));
};

/**
 * Returns the most frequently violated Tajweed rules for this user.
 */
const getTajweedViolations = async (userId) => {
  const violations = await prisma.feedback.groupBy({
    by: ["tajweedRuleId"],
    where: {
      session: { userId },
      tajweedRuleId: { not: null },
      errorType: "TAJWEED_VIOLATION",
    },
    _count: { tajweedRuleId: true },
    orderBy: { _count: { tajweedRuleId: "desc" } },
    take: 10,
  });

  // Enrich with rule names
  const ruleIds = violations
    .map((v) => v.tajweedRuleId)
    .filter(Boolean);

  const rules = await prisma.tajweedRule.findMany({
    where: { id: { in: ruleIds } },
    select: { id: true, ruleName: true, ruleCode: true, severity: true },
  });

  const ruleMap = Object.fromEntries(rules.map((r) => [r.id, r]));

  return violations.map((v) => ({
    rule: ruleMap[v.tajweedRuleId] || null,
    count: v._count.tajweedRuleId,
  }));
};

/**
 * Updates the dailyStreak field — called when a session is completed.
 * Increments if the last practice was yesterday; resets if more than 1 day ago.
 */
const updateDailyStreak = async (userId) => {
  const progress = await prisma.progress.findUnique({ where: { userId } });
  if (!progress) return;

  const now = new Date();
  const last = progress.lastPracticed;

  let newStreak = 1;

  if (last) {
    const diffMs = now.getTime() - last.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays < 1) {
      // Same day — keep streak
      newStreak = progress.dailyStreak;
    } else if (diffDays < 2) {
      // Yesterday — extend streak
      newStreak = progress.dailyStreak + 1;
    }
    // else: more than a day gap — reset to 1 (default above)
  }

  await prisma.progress.update({
    where: { userId },
    data: { dailyStreak: newStreak },
  });
};

module.exports = {
  getUserProgress,
  getAccuracyTrend,
  getErrorSummary,
  getTajweedViolations,
  updateDailyStreak,
};
