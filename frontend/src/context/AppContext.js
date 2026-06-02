import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { storage } from '../utils/storage';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id || null;

  const [surahs,         setSurahsState]      = useState([]);
  const [surahsLoaded,   setSurahsLoaded]     = useState(false);
  const [bookmarks,      setBookmarks]        = useState([]);
  const [localAvatarUri, setLocalAvatarUriState] = useState(null);
  const [persistedLoaded,setPersistedLoaded]  = useState(false);
  const [currentSession, setCurrentSession]   = useState(null);

  // Load (or clear) per-user persisted state when the signed-in user changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPersistedLoaded(false);
      if (!userId) {
        // Logout — clear in-memory state. Disk content is preserved so the
        // same user logging back in gets their bookmarks + avatar restored.
        setBookmarks([]);
        setLocalAvatarUriState(null);
        setPersistedLoaded(true);
        return;
      }
      const [bm, av] = await Promise.all([
        storage.getBookmarks(userId),
        storage.getAvatarUri(userId),
      ]);
      if (cancelled) return;
      setBookmarks(Array.isArray(bm) ? bm : []);
      setLocalAvatarUriState(av || null);
      setPersistedLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const setSurahData = useCallback((data) => {
    setSurahsState(data);
    setSurahsLoaded(true);
  }, []);

  const addBookmark = useCallback((item) => {
    setBookmarks((prev) => {
      const exists = prev.some(
        (b) => b.surahId === item.surahId && b.ayahNumber === item.ayahNumber,
      );
      const next = exists ? prev : [item, ...prev];
      if (!exists && userId) storage.setBookmarks(userId, next);
      return next;
    });
  }, [userId]);

  const removeBookmark = useCallback((surahId, ayahNumber) => {
    setBookmarks((prev) => {
      const next = prev.filter(
        (b) => !(b.surahId === surahId && b.ayahNumber === ayahNumber),
      );
      if (userId) storage.setBookmarks(userId, next);
      return next;
    });
  }, [userId]);

  const isBookmarked = useCallback(
    (surahId, ayahNumber) =>
      bookmarks.some((b) => b.surahId === surahId && b.ayahNumber === ayahNumber),
    [bookmarks],
  );

  const setLocalAvatarUri = useCallback((uri) => {
    setLocalAvatarUriState(uri || null);
    if (userId) storage.setAvatarUri(userId, uri);
  }, [userId]);

  return (
    <AppContext.Provider value={{
      surahs, surahsLoaded, setSurahData,
      bookmarks, addBookmark, removeBookmark, isBookmarked,
      localAvatarUri, setLocalAvatarUri,
      persistedLoaded,
      currentSession, setCurrentSession,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
};
