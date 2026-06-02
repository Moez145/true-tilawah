/**
 * Quran seeder — populates `quranic_texts` and `ayahs` tables from
 * the public Quran.com API (https://api.quran.com/api/v4).
 *
 * Idempotent: re-running upserts existing rows.
 *
 * Usage:
 *   npm run seed:quran
 *
 * Optional env vars:
 *   QURAN_TRANSLATION_EN_ID  English translation resource id (default 131 = Sahih International)
 *   QURAN_TRANSLATION_UR_ID  Urdu  translation resource id (default 234 = Fateh Muhammad Jalandhri)
 *   QURAN_AUDIO_RECITER      everyayah.com folder name      (default Alafasy_128kbps)
 *   QURAN_REQUEST_DELAY_MS   politeness delay between API calls (default 150)
 *
 * Browse alternative translation IDs at:
 *   https://api.quran.com/api/v4/resources/translations
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const API_BASE       = "https://api.quran.com/api/v4";
const TRANSLATION_EN = parseInt(process.env.QURAN_TRANSLATION_EN_ID || "131", 10);
const TRANSLATION_UR = parseInt(process.env.QURAN_TRANSLATION_UR_ID || "234", 10);
const AUDIO_RECITER  = process.env.QURAN_AUDIO_RECITER || "Alafasy_128kbps";
const REQUEST_DELAY  = parseInt(process.env.QURAN_REQUEST_DELAY_MS || "150", 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stripHtml = (s) => (s ? s.replace(/<[^>]+>/g, "").trim() : null);

async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "true-tilawah-seeder/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (err) {
    if (attempt < 3) {
      console.warn(`   retry ${attempt}/3 after error: ${err.message}`);
      await sleep(1000 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

async function fetchChapters() {
  const data = await fetchJson(`${API_BASE}/chapters?language=en`);
  return data.chapters; // 114 entries
}

async function fetchVerses(chapterNumber) {
  const url =
    `${API_BASE}/verses/by_chapter/${chapterNumber}` +
    `?language=en&words=false&fields=text_uthmani` +
    `&translations=${TRANSLATION_EN},${TRANSLATION_UR}` +
    `&per_page=300&page=1`;
  const data = await fetchJson(url);
  return data.verses;
}

function audioUrlFor(surah, ayah) {
  const s = String(surah).padStart(3, "0");
  const a = String(ayah).padStart(3, "0");
  return `https://everyayah.com/data/${AUDIO_RECITER}/${s}${a}.mp3`;
}

function pickTranslation(translations, resourceId) {
  if (!Array.isArray(translations)) return null;
  const t = translations.find((x) => x.resource_id === resourceId);
  return t ? stripHtml(t.text) : null;
}

async function seedSurah(chapter) {
  const surahNumber = chapter.id;
  const isMakki     = (chapter.revelation_place || "").toLowerCase() === "makkah";

  // 1. Upsert the QuranicText (surah metadata)
  const surah = await prisma.quranicText.upsert({
    where: { surahNumber },
    update: {
      surahName:   chapter.name_simple,
      surahNameAr: chapter.name_arabic,
      surahType:   isMakki ? "Makki" : "Madni",
      totalAyahs:  chapter.verses_count,
    },
    create: {
      surahNumber,
      surahName:   chapter.name_simple,
      surahNameAr: chapter.name_arabic,
      surahType:   isMakki ? "Makki" : "Madni",
      totalAyahs:  chapter.verses_count,
    },
  });

  // 2. Fetch all verses for this surah (single API call, per_page=300 covers Al-Baqarah's 286)
  const verses = await fetchVerses(surahNumber);

  // 3. Upsert all ayahs in a transaction (one DB round-trip per surah)
  await prisma.$transaction(
    verses.map((v) =>
      prisma.ayah.upsert({
        where: { surahId_ayahNumber: { surahId: surah.id, ayahNumber: v.verse_number } },
        update: {
          uthmaniText:   v.text_uthmani || "",
          translationEn: pickTranslation(v.translations, TRANSLATION_EN),
          translationUr: pickTranslation(v.translations, TRANSLATION_UR),
          audioUrl:      audioUrlFor(surahNumber, v.verse_number),
        },
        create: {
          surahId:       surah.id,
          ayahNumber:    v.verse_number,
          uthmaniText:   v.text_uthmani || "",
          translationEn: pickTranslation(v.translations, TRANSLATION_EN),
          translationUr: pickTranslation(v.translations, TRANSLATION_UR),
          audioUrl:      audioUrlFor(surahNumber, v.verse_number),
        },
      }),
    ),
  );

  return verses.length;
}

async function main() {
  console.log("Fetching chapter list from Quran.com ...");
  const chapters = await fetchChapters();
  console.log(`Got ${chapters.length} chapters. Beginning seed (~5-8 min).`);

  let totalVerses = 0;
  let surahCount  = 0;
  const t0 = Date.now();

  for (const ch of chapters) {
    const inserted = await seedSurah(ch);
    totalVerses += inserted;
    surahCount  += 1;
    const pct = ((surahCount / chapters.length) * 100).toFixed(1);
    console.log(
      `  [${surahCount.toString().padStart(3, "0")}/${chapters.length}] ` +
      `Surah ${ch.id.toString().padStart(3, "0")} ${ch.name_simple.padEnd(20)} ` +
      `${inserted.toString().padStart(3, " ")} verses (${pct}%)`,
    );
    if (REQUEST_DELAY > 0) await sleep(REQUEST_DELAY);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s. ${chapters.length} surahs, ${totalVerses} verses.`);
}

main()
  .catch((e) => {
    console.error("\nSeeder failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
