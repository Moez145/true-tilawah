const {
  createSession,
  getUserSessions,
  getSessionById,
  completeSession,
  abandonSession,
  deleteSession,
} = require("../services/session.service");
const { sendSuccess } = require("../utils/response.util");

/**
 * POST /api/sessions
 */
const create = async (req, res, next) => {
  try {
    const { surahId, ayahStart, ayahEnd } = req.body;
    const session = await createSession(req.user.id, {
      surahId: parseInt(surahId),
      ayahStart: parseInt(ayahStart),
      ayahEnd: parseInt(ayahEnd),
    });
    return sendSuccess(res, 201, "Session created.", session);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sessions
 */
const list = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const result = await getUserSessions(req.user.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      status: status || undefined,
    });
    return sendSuccess(res, 200, "Sessions fetched.", result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/sessions/:id
 */
const getOne = async (req, res, next) => {
  try {
    const session = await getSessionById(req.params.id, req.user.id);
    return sendSuccess(res, 200, "Session fetched.", session);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/sessions/:id/complete
 */
const complete = async (req, res, next) => {
  try {
    const { transcript, accuracyScore } = req.body;
    const session = await completeSession(req.params.id, req.user.id, {
      transcript,
      accuracyScore: parseFloat(accuracyScore),
    });
    return sendSuccess(res, 200, "Session completed.", session);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/sessions/:id/abandon
 */
const abandon = async (req, res, next) => {
  try {
    const session = await abandonSession(req.params.id, req.user.id);
    return sendSuccess(res, 200, "Session abandoned.", session);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/sessions/:id
 */
const remove = async (req, res, next) => {
  try {
    const result = await deleteSession(req.params.id, req.user.id);
    return sendSuccess(res, 200, "Session deleted.", result);
  } catch (error) {
    next(error);
  }
};

module.exports = { create, list, getOne, complete, abandon, remove };
