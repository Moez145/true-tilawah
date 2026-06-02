import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants';

export const storage = {
  async setAccessToken(token) {
    try { await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token); } catch (e) {}
  },
  async getAccessToken() {
    try { return await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN); } catch { return null; }
  },
  async setRefreshToken(token) {
    try { await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, token); } catch (e) {}
  },
  async getRefreshToken() {
    try { return await AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN); } catch { return null; }
  },
  async setUserData(user) {
    try { await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user)); } catch (e) {}
  },
  async getUserData() {
    try {
      const d = await AsyncStorage.getItem(STORAGE_KEYS.USER_DATA);
      return d ? JSON.parse(d) : null;
    } catch { return null; }
  },
  async setBookmarks(userId, list) {
    if (!userId) return;
    try {
      await AsyncStorage.setItem(
        `${STORAGE_KEYS.BOOKMARKS_PREFIX}${userId}`,
        JSON.stringify(list || []),
      );
    } catch {}
  },
  async getBookmarks(userId) {
    if (!userId) return [];
    try {
      const raw = await AsyncStorage.getItem(`${STORAGE_KEYS.BOOKMARKS_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },
  async setAvatarUri(userId, uri) {
    if (!userId) return;
    try {
      if (uri) {
        await AsyncStorage.setItem(`${STORAGE_KEYS.AVATAR_URI_PREFIX}${userId}`, String(uri));
      } else {
        await AsyncStorage.removeItem(`${STORAGE_KEYS.AVATAR_URI_PREFIX}${userId}`);
      }
    } catch {}
  },
  async getAvatarUri(userId) {
    if (!userId) return null;
    try {
      return await AsyncStorage.getItem(`${STORAGE_KEYS.AVATAR_URI_PREFIX}${userId}`);
    } catch { return null; }
  },
  async clearAll() {
    try {
      await AsyncStorage.multiRemove([
        STORAGE_KEYS.ACCESS_TOKEN,
        STORAGE_KEYS.REFRESH_TOKEN,
        STORAGE_KEYS.USER_DATA,
      ]);
    } catch (e) {}
  },
};
