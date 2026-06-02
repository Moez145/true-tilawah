import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService } from '../services/authService';
import { storage } from '../utils/storage';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user,            setUser]            = useState(null);
  const [loading,         setLoading]         = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => { _bootstrap(); }, []);

  const _bootstrap = async () => {
    try {
      const [token, cached] = await Promise.all([
        storage.getAccessToken(),
        storage.getUserData(),
      ]);
      if (token && cached) {
        setUser(cached);
        setIsAuthenticated(true);
        // try to get fresh profile
        try {
          const fresh = await authService.getProfile();
          setUser(fresh);
          await storage.setUserData(fresh);
        } catch {
          // token expired – try refresh
          try {
            await authService.refreshToken();
            const fresh = await authService.getProfile();
            setUser(fresh);
            await storage.setUserData(fresh);
          } catch {
            await _logout();
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const _logout = async () => {
    await storage.clearAll();
    setUser(null);
    setIsAuthenticated(false);
  };

  const login = useCallback(async (creds) => {
    const data = await authService.login(creds);
    setUser(data.user);
    setIsAuthenticated(true);
    return data;
  }, []);

  const register = useCallback(async (info) => {
    const data = await authService.register(info);
    setUser(data.user);
    setIsAuthenticated(true);
    return data;
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
    setIsAuthenticated(false);
  }, []);

  const updateUser = useCallback((u) => {
    setUser(u);
    storage.setUserData(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isAuthenticated, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
