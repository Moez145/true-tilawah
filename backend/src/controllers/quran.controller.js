const {
  getAllSurahs,
  getSurahByNumber,
  getAyahsBySurah,
  getAyah,
  getAyahRange,
} = require("../services/quran.service");
const { sendSuccess } = require("../utils/response.util");

/**
 * GET /api/quran/surahs
 */
const listSurahs = async (req, res, next) => {
  try {
    const surahs = await getAllSurahs();
    return sendSuccess(res, 200, "Surahs fetched.", surahs);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/quran/surahs/:number
 */
const getSurah = async (req, res, next) => {
  try {
    const surah = await getSurahByNumber(parseInt(req.params.number));
    return sendSuccess(res, 200, "Surah fetched.", surah);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/quran/surahs/:number/ayahs
 */
const listAyahs = async (req, res, next) => {
  try {
    const data = await getAyahsBySurah(parseInt(req.params.number));
    return sendSuccess(res, 200, "Ayahs fetched.", data);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/quran/surahs/:number/ayahs/:ayahNumber
 */
const getOneAyah = async (req, res, next) => {
  try {
    const ayah = await getAyah(
      parseInt(req.params.number),
      parseInt(req.params.ayahNumber)
    );
    return sendSuccess(res, 200, "Ayah fetched.", ayah);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/quran/surahs/:number/range?start=1&end=7
 */
const getRange = async (req, res, next) => {
  try {
    const { start, end } = req.query;
    const data = await getAyahRange(
      parseInt(req.params.number),
      parseInt(start),
      parseInt(end)
    );
    return sendSuccess(res, 200, "Ayah range fetched.", data);
  } catch (error) {
    next(error);
  }
};

module.exports = { listSurahs, getSurah, listAyahs, getOneAyah, getRange };
