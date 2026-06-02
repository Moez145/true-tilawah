const { body, param, query } = require("express-validator");

const createSessionValidator = [
  body("surahId")
    .notEmpty().withMessage("surahId is required.")
    .isInt({ min: 1, max: 114 }).withMessage("surahId must be between 1 and 114."),

  body("ayahStart")
    .notEmpty().withMessage("ayahStart is required.")
    .isInt({ min: 1 }).withMessage("ayahStart must be a positive integer."),

  body("ayahEnd")
    .notEmpty().withMessage("ayahEnd is required.")
    .isInt({ min: 1 }).withMessage("ayahEnd must be a positive integer.")
    .custom((val, { req }) => {
      if (parseInt(val) < parseInt(req.body.ayahStart)) {
        throw new Error("ayahEnd must be greater than or equal to ayahStart.");
      }
      return true;
    }),
];

const completeSessionValidator = [
  body("accuracyScore")
    .notEmpty().withMessage("accuracyScore is required.")
    .isFloat({ min: 0, max: 100 }).withMessage("accuracyScore must be between 0 and 100."),

  body("transcript")
    .optional()
    .isString().withMessage("transcript must be a string."),
];

const listSessionValidator = [
  query("page")
    .optional()
    .isInt({ min: 1 }).withMessage("page must be a positive integer."),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100."),

  query("status")
    .optional()
    .isIn(["ACTIVE", "COMPLETED", "ABANDONED"])
    .withMessage("status must be ACTIVE, COMPLETED, or ABANDONED."),
];

module.exports = {
  createSessionValidator,
  completeSessionValidator,
  listSessionValidator,
};
