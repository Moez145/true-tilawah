const { verifyAccessToken } = require("../utils/jwt.util");
const { sendError } = require("../utils/response.util");
const prisma = require("../models/prismaClient");

/**
 * Protects routes by validating the Bearer token in the Authorization header.
 * On success, attaches `req.user` (id, email, fullName) for downstream use.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(res, 401, "Access denied. No token provided.");
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return sendError(res, 401, "Access denied. Token is malformed.");
    }

    // Verify signature + expiry
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtError) {
      if (jwtError.name === "TokenExpiredError") {
        return sendError(res, 401, "Token expired. Please log in again.");
      }
      return sendError(res, 401, "Invalid token. Please log in again.");
    }

    // Confirm user still exists in DB (handles deleted accounts)
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, fullName: true },
    });

    if (!user) {
      return sendError(res, 401, "User no longer exists.");
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("authenticate middleware error:", error);
    return sendError(res, 500, "Authentication check failed.");
  }
};

module.exports = { authenticate };
