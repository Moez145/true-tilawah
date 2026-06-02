const { Router } = require("express");
const { register, login, refresh, profile } = require("../controllers/auth.controller");
const { authenticate } = require("../middleware/auth.middleware");
const { validate } = require("../middleware/validate.middleware");
const { registerValidator, loginValidator } = require("./validators/auth.validator");

const router = Router();

// POST /api/auth/register
router.post("/register", registerValidator, validate, register);

// POST /api/auth/login
router.post("/login", loginValidator, validate, login);

// POST /api/auth/refresh
router.post("/refresh", refresh);

// GET /api/auth/profile  [protected]
router.get("/profile", authenticate, profile);

module.exports = router;
