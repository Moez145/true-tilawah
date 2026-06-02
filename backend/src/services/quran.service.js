const prisma = require("../models/prismaClient");

/**
 * Returns all 114 Surahs (lightweight listing for the Surah selection screen).
 */
const getAllSurahs = async () => {
  return prisma.quranicText.findMany({
    orderBy: { surahNumber: "asc" },
    select: {
      id: true,
      surahNumber: true,
      surahName: true,
      surahNameAr: true,
      surahType: true,
      totalAyahs: true,
    },
  });
};

/**
 * Returns a single Surah's metadata.
 */
const getSurahByNumber = async (surahNumber) => {
  const surah = await prisma.quranicText.findUnique({
    where: { surahNumber },
    select: {
      id: true,
      surahNumber: true,
      surahName: true,
      surahNameAr: true,
      surahType: true,
      totalAyahs: true,
    },
  });

  if (!surah) {
    const err = new Error(`Surah ${surahNumber} not found.`);
    err.statusCode = 404;
    throw err;
  }

  return surah;
};

/**
 * Returns all Ayahs for a given Surah number.
 */
const getAyahsBySurah = async (surahNumber) => {
  const surah = await prisma.quranicText.findUnique({
    where: { surahNumber },
    include: {
      ayahs: {
        orderBy: { ayahNumber: "asc" },
      },
    },
  });

  if (!surah) {
    const err = new Error(`Surah ${surahNumber} not found.`);
    err.statusCode = 404;
    throw err;
  }

  return surah;
};

/**
 * Returns a specific Ayah by Surah number and Ayah number.
 */
const getAyah = async (surahNumber, ayahNumber) => {
  const surah = await prisma.quranicText.findUnique({
    where: { surahNumber },
    select: { id: true },
  });

  if (!surah) {
    const err = new Error(`Surah ${surahNumber} not found.`);
    err.statusCode = 404;
    throw err;
  }

  const ayah = await prisma.ayah.findUnique({
    where: { surahId_ayahNumber: { surahId: surah.id, ayahNumber } },
  });

  if (!ayah) {
    const err = new Error(
      `Ayah ${ayahNumber} not found in Surah ${surahNumber}.`
    );
    err.statusCode = 404;
    throw err;
  }

  return ayah;
};

/**
 * Returns a range of Ayahs (for recitation sessions).
 */
const getAyahRange = async (surahNumber, ayahStart, ayahEnd) => {
  const surah = await prisma.quranicText.findUnique({
    where: { surahNumber },
    select: { id: true, surahName: true, totalAyahs: true },
  });

  if (!surah) {
    const err = new Error(`Surah ${surahNumber} not found.`);
    err.statusCode = 404;
    throw err;
  }

  if (
    ayahStart < 1 ||
    ayahEnd > surah.totalAyahs ||
    ayahStart > ayahEnd
  ) {
    const err = new Error(
      `Invalid Ayah range for ${surah.surahName} (total: ${surah.totalAyahs}).`
    );
    err.statusCode = 400;
    throw err;
  }

  const ayahs = await prisma.ayah.findMany({
    where: {
      surahId: surah.id,
      ayahNumber: { gte: ayahStart, lte: ayahEnd },
    },
    orderBy: { ayahNumber: "asc" },
  });

  return { surahNumber, surahName: surah.surahName, ayahs };
};

module.exports = {
  getAllSurahs,
  getSurahByNumber,
  getAyahsBySurah,
  getAyah,
  getAyahRange,
};
