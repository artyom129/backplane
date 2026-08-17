import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  api,
  clearTokens,
  currentRefreshToken,
  saveTokens,
  setAuthFailureHandler,
} from "@/lib/api";
import type { AuthResponse, User } from "@/types";

interface RegisterInput {
  email: string;
  full_name: string;
  password: string;
  organization_name: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthFailureHandler(() => setUser(null));
    const restore = async () => {
      const refreshToken = currentRefreshToken();
      if (!refreshToken) {
        setLoading(false);
        return;
      }
      try {
        const tokens = await api.post<AuthResponse["tokens"]>("/auth/refresh", {
          refresh_token: refreshToken,
        });
        saveTokens(tokens);
        setUser(await api.get<User>("/auth/me"));
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    };
    void restore();
    return () => setAuthFailureHandler(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(email, password) {
        const response = await api.post<AuthResponse>("/auth/login", { email, password });
        saveTokens(response.tokens);
        setUser(response.user);
      },
      async register(input) {
        const response = await api.post<AuthResponse>("/auth/register", input);
        saveTokens(response.tokens);
        setUser(response.user);
      },
      async logout() {
        const refreshToken = currentRefreshToken();
        try {
          if (refreshToken) {
            await api.post("/auth/logout", { refresh_token: refreshToken });
          }
        } finally {
          clearTokens();
          setUser(null);
        }
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

