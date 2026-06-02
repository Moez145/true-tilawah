const { Router } = require("express");
const {
  listSurahs,
  getSurah,
  listAyahs,
  getOneAyah,
  getRange,
} = require("../controllers/quran.controller");
const { listTajweedRules } = require("../controllers/feedback.controller");

const router = Router();

// All Quran reference routes are public (no auth required)

// GET /api/quran/surahs
router.get("/surahs", listSurahs);

// GET /api/quran/surahs/:number
router.get("/surahs/:number", getSurah);

// GET /api/quran/surahs/:number/ayahs
router.get("/surahs/:number/ayahs", listAyahs);

// GET /api/quran/surahs/:number/ayahs/:ayahNumber
router.get("/surahs/:number/ayahs/:ayahNumber", getOneAyah);

// GET /api/quran/surahs/:number/range?start=1&end=7
router.get("/surahs/:number/range", getRange);

// GET /api/quran/tajweed-rules
router.get("/tajweed-rules", listTajweedRules);

module.exports = router;
