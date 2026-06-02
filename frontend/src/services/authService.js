import axios from 'axios';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { API_BASE_URL, GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID } from '../constants';
import { storage } from '../utils/storage';
import apiClient from './apiClient';

WebBrowser.maybeCompleteAuthSession();

const saveSession = async (data) => {
  await storage.setAccessToken(data.accessToken);
  await storage.setRefreshToken(data.refreshToken);
  await storage.setUserData(data.user);
};

export const authService = {
  // ─── Register ────────────────────────────────────────────────────────────────
  async register({ fullName, email, password }) {
    const res = await axios.post(`${API_BASE_URL}/auth/register`, { fullName, email, password });
    await saveSession(res.data.data);
    return res.data.data;
  },

  // ─── Login ───────────────────────────────────────────────────────────────────
  async login({ email, password }) {
    const res = await axios.post(`${API_BASE_URL}/auth/login`, { email, password });
    await saveSession(res.data.data);
    return res.data.data;
  },

  // ─── Logout ──────────────────────────────────────────────────────────────────
  async logout() {
    await storage.clearAll();
  },

  // ─── Profile ─────────────────────────────────────────────────────────────────
  async getProfile() {
    const res = await apiClient.get('/auth/profile');
    return res.data.data;
  },

  // ─── Refresh Token ───────────────────────────────────────────────────────────
  async refreshToken() {
    const refreshToken = await storage.getRefreshToken();
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    await storage.setAccessToken(res.data.data.accessToken);
    return res.data.data.accessToken;
  },

  // ─── Google OAuth hook (call inside component) ────────────────────────────────
  useGoogleAuth() {
    return Google.useAuthRequest({
      webClientId:     GOOGLE_WEB_CLIENT_ID,
      androidClientId: GOOGLE_ANDROID_CLIENT_ID,
      iosClientId:     GOOGLE_IOS_CLIENT_ID,
    });
  },

  async handleGoogleResponse(response) {
    if (response?.type !== 'success') throw new Error('Google sign-in cancelled');
    const { authentication } = response;
    // Fetch Google profile
    const userInfo = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${authentication.accessToken}` },
    });
    const g = userInfo.data;
    // POST to backend /auth/google  (add this route to backend if needed)
    const res = await axios.post(`${API_BASE_URL}/auth/google`, {
      googleId:    g.sub,
      email:       g.email,
      fullName:    g.name,
      avatarUrl:   g.picture,
      accessToken: authentication.accessToken,
    });
    await saveSession(res.data.data);
    return res.data.data;
  },

  // ─── Apple Sign-In ────────────────────────────────────────────────────────────
  async signInWithApple() {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    const fullName =
      credential.fullName
        ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
        : 'Apple User';
    // POST to backend /auth/apple  (add this route to backend if needed)
    const res = await axios.post(`${API_BASE_URL}/auth/apple`, {
      appleId:       credential.user,
      email:         credential.email,
      fullName,
      identityToken: credential.identityToken,
    });
    await saveSession(res.data.data);
    return res.data.data;
  },
};
