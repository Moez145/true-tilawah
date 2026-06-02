/**
 * Sends a successful JSON response.
 *
 * @param {object} res       - Express response object
 * @param {number} statusCode - HTTP status code (default 200)
 * @param {string} message   - Human-readable message
 * @param {any}    data      - Payload to return
 */
const sendSuccess = (res, statusCode = 200, message = "Success", data = null) => {
  const body = { success: true, message };
  if (data !== null) body.data = data;
  return res.status(statusCode).json(body);
};

/**
 * Sends an error JSON response.
 *
 * @param {object} res       - Express response object
 * @param {number} statusCode - HTTP status code (default 500)
 * @param {string} message   - Human-readable error message
 * @param {any}    errors    - Optional field-level errors (e.g. from validators)
 */
const sendError = (res, statusCode = 500, message = "Internal Server Error", errors = null) => {
  const body = { success: false, message };
  if (errors !== null) body.errors = errors;
  return res.status(statusCode).json(body);
};

module.exports = { sendSuccess, sendError };
