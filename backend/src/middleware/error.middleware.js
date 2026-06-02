const { sendError } = require("../utils/response.util");

/**
 * Catches errors thrown by Prisma and maps them to HTTP-friendly responses.
 */
const prismaErrorHandler = (error, req, res, next) => {
  // Unique constraint violation (e.g. duplicate email)
  if (error.code === "P2002") {
    const field = error.meta?.target?.join(", ") || "field";
    return sendError(res, 409, `A record with this ${field} already exists.`);
  }

  // Record not found
  if (error.code === "P2025") {
    return sendError(res, 404, "Record not found.");
  }

  // Foreign key constraint failure
  if (error.code === "P2003") {
    return sendError(res, 400, "Related record does not exist.");
  }

  next(error);
};

/**
 * Final fallback error handler.
 * Must have 4 parameters for Express to treat it as an error handler.
 */
// eslint-disable-next-line no-unused-vars
const globalErrorHandler = (error, req, res, next) => {
  console.error("Unhandled error:", error);

  const statusCode = error.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "Something went wrong. Please try again later."
      : error.message;

  return sendError(res, statusCode, message);
};

/**
 * 404 handler for routes that don't exist.
 */
const notFoundHandler = (req, res) => {
  return sendError(res, 404, `Route ${req.method} ${req.originalUrl} not found.`);
};

module.exports = { prismaErrorHandler, globalErrorHandler, notFoundHandler };
