"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  clearTokens,
  fetchMe,
  getAccess,
  login as apiLogin,
  register as apiRegister,
  type RegisterPayload,
} from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  register: (payload: RegisterPayload) => Promise<User>;
  refresh: () => Promise<void>;
  isLeader: boolean;
  isApproved: boolean;
  ownsTeam: (teamId: number | null) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
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
    async (username: string, password: string) => {
      await apiLogin(username, password);
      await loadUser();
    },
    [loadUser]
  );

  const register = useCallback(
    (payload: RegisterPayload) => apiRegister(payload),
    []
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    loading,
    login,
    logout,
    register,
    refresh: loadUser,
    isLeader: !!user && user.role === "leader" && user.is_approved,
    isApproved: !!user && (user.is_approved || user.is_staff),
    ownsTeam: (teamId) => !!user && teamId !== null && user.team === teamId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
