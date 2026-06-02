import apiClient from './apiClient';

export const progressService = {
  // GET /api/progress
  async getProgress() {
    const res = await apiClient.get('/progress');
    return res.data.data;
  },

  // GET /api/progress/trend?limit=10
  async getAccuracyTrend(limit = 10) {
    const res = await apiClient.get('/progress/trend', { params: { limit } });
    return res.data.data;
  },

  // GET /api/progress/errors
  async getErrorSummary() {
    const res = await apiClient.get('/progress/errors');
    return res.data.data;
  },

  // GET /api/progress/tajweed
  async getTajweedViolations() {
    const res = await apiClient.get('/progress/tajweed');
    return res.data.data;
  },
};
