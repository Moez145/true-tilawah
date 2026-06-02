const prisma = require("../models/prismaClient");

const createSession = async (userId, { surahId, ayahStart, ayahEnd }) => {
  const surah = await prisma.quranicText.findUnique({
    where: { surahNumber: surahId },
  });

  if (!surah) {
    const err = new Error(`Surah number ${surahId} does not exist.`);
    err.statusCode = 404;
    throw err;
  }

  if (ayahStart < 1 || ayahEnd > surah.totalAyahs || ayahStart > ayahEnd) {
    const err = new Error(
      `Invalid Ayah range. Surah ${surah.surahName} has ${surah.totalAyahs} Ayahs.`
    );
    err.statusCode = 400;
    throw err;
  }

  const session = await prisma.session.create({
    data: { userId, surahId, ayahStart, ayahEnd },
    include: { quranicText: { select: { surahName: true, surahNameAr: true } } },
  });

  return session;
};

const getUserSessions = async (userId, { page = 1, limit = 10, status } = {}) => {
  const skip = (page - 1) * limit;
  const where = { userId };
  if (status) where.status = status;

  const [sessions, total] = await prisma.$transaction([
    prisma.session.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        quranicText: { select: { surahName: true, surahNameAr: true } },
        _count: { select: { feedbacks: true, recordings: true } },
      },
    }),
    prisma.session.count({ where }),
  ]);

  return {
    sessions,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getSessionById = async (sessionId, userId) => {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
    include: {
      quranicText: true,
      feedbacks: {
        include: { tajweedRule: true },
        orderBy: { createdAt: "asc" },
      },
      recordings: { orderBy: { timestampStart: "asc" } },
    },
  });

  if (!session) {
    const err = new Error("Session not found.");
    err.statusCode = 404;
    throw err;
  }

  return session;
};

const completeSession = async (sessionId, userId, { transcript, accuracyScore }) => {
  // Find session by id and userId — allow any status for robustness
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    const err = new Error("Session not found.");
    err.statusCode = 404;
    throw err;
  }

  // If already completed return as-is
  if (session.status === "COMPLETED") {
    return session;
  }

  const endTime    = new Date();
  const durationSec = Math.round(
    (endTime.getTime() - session.startTime.getTime()) / 1000
  );

  // Update session
  const updatedSession = await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      endTime,
      durationSec,
      transcript:    transcript ?? "",
      accuracyScore: accuracyScore ?? 0,
    },
  });

  // Update progress using Prisma aggregate (no raw SQL — avoids GROUP BY issue)
  try {
    const stats = await prisma.session.aggregate({
      where: { userId, status: "COMPLETED" },
      _count: { id: true },
      _avg:   { accuracyScore: true },
      _sum:   { durationSec: true },
    });

    await prisma.progress.updateMany({
      where: { userId },
      data: {
        totalSessions:   stats._count.id,
        averageAccuracy: stats._avg.accuracyScore || 0,
        totalTimeMin:    Math.round((stats._sum.durationSec || 0) / 60),
        lastPracticed:   new Date(),
      },
    });
  } catch (e) {
    console.error("Progress update failed (non-fatal):", e.message);
  }

  return updatedSession;
};

const abandonSession = async (sessionId, userId) => {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    const err = new Error("Session not found.");
    err.statusCode = 404;
    throw err;
  }

  // Already completed or abandoned — return as-is
  if (session.status !== "ACTIVE") return session;

  return prisma.session.update({
    where: { id: sessionId },
    data: { status: "ABANDONED", endTime: new Date() },
  });
};

const deleteSession = async (sessionId, userId) => {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });

  if (!session) {
    const err = new Error("Session not found.");
    err.statusCode = 404;
    throw err;
  }

  await prisma.session.delete({ where: { id: sessionId } });
  return { deleted: true };
};

module.exports = {
  createSession,
  getUserSessions,
  getSessionById,
  completeSession,
  abandonSession,
  deleteSession,
};