const { validationResult } = require("express-validator");
const { sendError } = require("../utils/response.util");

/**
 * Reads the results of `express-validator` chains and returns a 422
 * with structured field errors if any fail.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formatted = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));
    return sendError(res, 422, "Validation failed.", formatted);
  }

  next();
};

module.exports = { validate };
