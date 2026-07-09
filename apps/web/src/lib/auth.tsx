'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, hasSession, refreshSession, serverLogout, setTokens } from './api';

export interface Me {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
}

interface AuthContextValue {
  user: Me | null;
  ready: boolean;
  /** Resolves with the account's role so callers can route staff to /admin. */
  login: (identifier: string, password: string) => Promise<{ role: string }>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
}

/** Role claim from the (unverified, display-only) JWT payload. */
function roleFromToken(accessToken: string): string {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1] ?? '')) as { role?: string };
    return payload.role ?? 'USER';
  } catch {
    return 'USER';
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [restored, setRestored] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (!hasSession()) {
      setRestored(true);
      return;
    }
    void refreshSession().then((ok) => {
      setAuthed(ok);
      setRestored(true);
    });
  }, []);

  const { data: user = null, isLoading } = useQuery({
    queryKey: ['me'],
    enabled: restored && authed,
    queryFn: async () => (await api.get<Me>('/users/me')).data,
  });

  const applyTokens = async (data: { accessToken: string }) => {
    setTokens(data);
    setAuthed(true);
    await queryClient.invalidateQueries();
  };

  const value: AuthContextValue = {
    user,
    ready: restored && !isLoading,
    login: async (identifier, password) => {
      const { data } = await api.post('/auth/login', { identifier, password });
      await applyTokens(data);
      return { role: roleFromToken(data.accessToken) };
    },
    register: async (email, username, password) => {
      const { data } = await api.post('/auth/register', { email, username, password });
      await applyTokens(data);
    },
    logout: () => {
      void serverLogout(); // revokes the session family + clears the cookie
      setAuthed(false);
      queryClient.clear();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
