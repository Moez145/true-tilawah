import apiClient from './apiClient';

export const sessionService = {
  // POST /api/sessions
  async createSession({ surahId, ayahStart, ayahEnd }) {
    const res = await apiClient.post('/sessions', { surahId, ayahStart, ayahEnd });
    return res.data.data;
  },

  // GET /api/sessions?page=1&limit=10&status=COMPLETED
  async getSessions({ page = 1, limit = 10, status } = {}) {
    const params = { page, limit };
    if (status) params.status = status;
    const res = await apiClient.get('/sessions', { params });
    return res.data.data;
  },

  // GET /api/sessions/:id
  async getSession(id) {
    const res = await apiClient.get(`/sessions/${id}`);
    return res.data.data;
  },

  // PATCH /api/sessions/:id/complete
  async completeSession(id, { transcript, accuracyScore }) {
    const res = await apiClient.patch(`/sessions/${id}/complete`, {
      transcript: transcript || '',
      accuracyScore: Number(accuracyScore) || 0,
    });
    return res.data.data;
  },

  // PATCH /api/sessions/:id/abandon
  async abandonSession(id) {
    const res = await apiClient.patch(`/sessions/${id}/abandon`);
    return res.data.data;
  },

  // DELETE /api/sessions/:id
  async deleteSession(id) {
    const res = await apiClient.delete(`/sessions/${id}`);
    return res.data.data;
  },
};
