import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Auth, type User } from '../api/endpoints';
import { setToken } from '../api/client';
import * as SecureStore from '../lib/secureStore';
import { go } from '../navigation/ref';

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  register: (body: any) => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  // Passwordless phone login — upserts the user, promotes guest sessions.
  phoneLogin: (phone: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);
const TOKEN_KEY = 'iq2_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItem(TOKEN_KEY);
        if (token) {
          setToken(token);
          const me = await Auth.me();
          setUser(me.user);
        } else {
          // No token yet — auto-create a guest session so every action
          // (post a listing, chat, save) just works without any auth UI.
          // Real signup is offered as an upgrade later.
          const r = await Auth.guest();
          await persist(r.token, r.user);
        }
      } catch {
        await SecureStore.deleteItem(TOKEN_KEY);
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(async (token: string, u: User) => {
    await SecureStore.setItem(TOKEN_KEY, token);
    setToken(token);
    setUser(u);
  }, []);

  const login = useCallback(
    async (phone: string, password: string) => {
      const r = await Auth.login(phone, password);
      await persist(r.token, r.user);
    },
    [persist],
  );

  const register = useCallback(
    async (body: any) => {
      const r = await Auth.register(body);
      await persist(r.token, r.user);
    },
    [persist],
  );

  const phoneLogin = useCallback(
    async (phone: string) => {
      const r = await Auth.phoneLogin(phone);
      await persist(r.token, r.user);
    },
    [persist],
  );

  const refresh = useCallback(async () => {
    try {
      const me = await Auth.me();
      setUser(me.user);
    } catch {}
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    // Drop the user on the phone-entry screen. Done centrally so any
    // logout button in the app produces the same redirect behavior.
    // (The original screen stays mounted underneath the modal — when
    // the user logs in via AuthGate it pops itself and we land back
    // on the Profile tab with `user` re-populated.)
    go('AuthGate');
  }, []);

  return <AuthCtx.Provider value={{ user, loading, refresh, login, register, phoneLogin, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
