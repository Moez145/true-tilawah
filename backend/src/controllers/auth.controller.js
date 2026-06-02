const { registerUser, loginUser, refreshAccessToken, getProfile } = require("../services/auth.service");
const { sendSuccess, sendError } = require("../utils/response.util");

/**
 * POST /api/auth/register
 */
const register = async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;
    const result = await registerUser({ fullName, email, password });
    return sendSuccess(res, 201, "Account created successfully.", result);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser({ email, password });
    return sendSuccess(res, 200, "Logged in successfully.", result);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/refresh
 */
const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return sendError(res, 400, "refreshToken is required.");
    }
    const result = await refreshAccessToken(refreshToken);
    return sendSuccess(res, 200, "Token refreshed.", result);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/auth/profile
 * Protected — requires authenticate middleware
 */
const profile = async (req, res, next) => {
  try {
    const user = await getProfile(req.user.id);
    return sendSuccess(res, 200, "Profile fetched.", user);
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, refresh, profile };
