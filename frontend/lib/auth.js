"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  clearTokens,
  fetchMe,
  getAccess,
  login as apiLogin,
  register as apiRegister,
} from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    if (!getAccess()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await fetchMe());
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = useCallback(
    async (username, password) => {
      await apiLogin(username, password);
      await loadUser();
    },
    [loadUser]
  );

  const register = useCallback((payload) => apiRegister(payload), []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const value = {
    user,
    loading,
    login,
    logout,
    register,
    refresh: loadUser,
    isLeader: !!user && user.role === "leader" && user.is_approved,
    isApproved: !!user && (user.is_approved || user.is_staff),
    ownsTeam: (teamId) => !!user && user.team === teamId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
