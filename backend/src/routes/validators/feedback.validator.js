const { body } = require("express-validator");

const VALID_ERROR_TYPES = [
  "MISPRONUNCIATION",
  "OMITTED_WORD",
  "ADDED_WORD",
  "TAJWEED_VIOLATION",
  "UNCLEAR_SPEECH",
];

const feedbackValidator = [
  body("errorType")
    .notEmpty().withMessage("errorType is required.")
    .isIn(VALID_ERROR_TYPES)
    .withMessage(`errorType must be one of: ${VALID_ERROR_TYPES.join(", ")}.`),

  body("incorrectWord")
    .notEmpty().withMessage("incorrectWord is required.")
    .isString().withMessage("incorrectWord must be a string."),

  body("correctWord")
    .notEmpty().withMessage("correctWord is required.")
    .isString().withMessage("correctWord must be a string."),

  body("wordPosition")
    .optional()
    .isInt({ min: 0 }).withMessage("wordPosition must be a non-negative integer."),

  body("ayahNumber")
    .optional()
    .isInt({ min: 1 }).withMessage("ayahNumber must be a positive integer."),

  body("confidenceScore")
    .optional()
    .isFloat({ min: 0, max: 1 }).withMessage("confidenceScore must be between 0 and 1."),

  body("tajweedRuleId")
    .optional()
    .isUUID().withMessage("tajweedRuleId must be a valid UUID."),
];

module.exports = { feedbackValidator };
