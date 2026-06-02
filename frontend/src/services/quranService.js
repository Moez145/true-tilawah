import apiClient from './apiClient';

export const quranService = {
  // All 114 Surahs (lightweight list)
  async getAllSurahs() {
    const res = await apiClient.get('/quran/surahs');
    return res.data.data;
  },

  // Single Surah metadata
  async getSurahByNumber(num) {
    const res = await apiClient.get(`/quran/surahs/${num}`);
    return res.data.data;
  },

  // All Ayahs for a Surah (returns { surah, ayahs[] })
  async getAyahsBySurah(num) {
    const res = await apiClient.get(`/quran/surahs/${num}/ayahs`);
    return res.data.data;
  },

  // Single Ayah
  async getAyah(surahNum, ayahNum) {
    const res = await apiClient.get(`/quran/surahs/${surahNum}/ayahs/${ayahNum}`);
    return res.data.data;
  },

  // Ayah range  GET /quran/surahs/:num/range?start=1&end=7
  async getAyahRange(surahNum, start, end) {
    const res = await apiClient.get(`/quran/surahs/${surahNum}/range?start=${start}&end=${end}`);
    return res.data.data;
  },

  // All Tajweed rules reference table
  async getTajweedRules() {
    const res = await apiClient.get('/quran/tajweed-rules');
    return res.data.data;
  },
};
