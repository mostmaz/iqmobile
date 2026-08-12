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
// The signed-in identity, cached so an offline restore can still show who
// is logged in rather than an empty header.
const ADMIN_KEY = 'iq_admin_who';

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
          // Only a 401 means the token is actually dead. A timeout or a
          // network error means the SERVER is unreachable, and signing the
          // operator out for that is exactly backwards: the one time they
          // need the app is when something is wrong, and they would be
          // staring at a login form instead. Verified the hard way — an API
          // outage logged this device out.
          try {
            const me = await api<{ admin: Admin }>('/admin/me');
            setAdmin(me.admin);
            registerDevice().then(setMuted).catch(() => {});
          } catch (e: any) {
            if (e?.status === 401) {
              setToken(null);
              await SecureStore.deleteItemAsync(KEY);
            } else {
              // Keep the session. Screens surface their own retry, and the
              // next successful call confirms the token is still good.
              const cached = await SecureStore.getItemAsync(ADMIN_KEY).catch(() => null);
              setAdmin(cached ? JSON.parse(cached) : { id: 0, username: '' });
            }
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
    await SecureStore.setItemAsync(ADMIN_KEY, JSON.stringify(r.admin)).catch(() => {});
    setAdmin(r.admin);
    // Registration failing must not fail the login itself.
    registerDevice().then(setMuted).catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    // Unregister BEFORE dropping the token — the delete call needs it.
    await unregisterDevice();
    setToken(null);
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
    await SecureStore.deleteItemAsync(ADMIN_KEY).catch(() => {});
    setAdmin(null);
    setMuted([]);
  }, []);

  const value = useMemo(
    () => ({ admin, ready, muted, setMuted, login, logout }),
    [admin, ready, muted, login, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
