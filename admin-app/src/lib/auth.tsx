// Admin session.
//
// The token is the only thing persisted, in SecureStore rather than
// AsyncStorage — it is a full-privilege credential for the whole
// marketplace, and a device backup should not carry it in the clear.
//
// The username and password themselves are never stored anywhere: they go
// straight from the login field into one request and are dropped.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setToken } from '../api/client';
import { registerDevice, unregisterDevice, type AdminPushKind } from './push';

const KEY = 'iq_admin_token';

type Admin = { id: number; username: string };

type AuthCtx = {
  admin: Admin | null;
  ready: boolean;
  muted: AdminPushKind[];
  setMuted: (m: AdminPushKind[]) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState<AdminPushKind[]>([]);

  // Restore on cold start. A stored token can be expired or revoked, so it
  // is verified against a cheap authenticated endpoint before we trust it —
  // otherwise the app opens onto a shell of empty screens that all 401.
  useEffect(() => {
    (async () => {
      try {
        const t = await SecureStore.getItemAsync(KEY);
        if (t) {
          setToken(t);
          const me = await api<{ admin: Admin }>('/admin/me').catch(() => null);
          if (me?.admin) {
            setAdmin(me.admin);
            registerDevice().then(setMuted).catch(() => {});
          } else {
            setToken(null);
            await SecureStore.deleteItemAsync(KEY);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; admin: Admin }>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(r.token);
    await SecureStore.setItemAsync(KEY, r.token);
    setAdmin(r.admin);
    // Registration failing must not fail the login itself.
    registerDevice().then(setMuted).catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    // Unregister BEFORE dropping the token — the delete call needs it.
    await unregisterDevice();
    setToken(null);
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
    setAdmin(null);
    setMuted([]);
  }, []);

  const value = useMemo(
    () => ({ admin, ready, muted, setMuted, login, logout }),
    [admin, ready, muted, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
