import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Auth, type User } from '../api/endpoints';
import { setToken } from '../api/client';
import * as SecureStore from '../lib/secureStore';
import { go } from '../navigation/ref';
import { useIdentify, useResetIdentity, useTrack } from '../analytics/track';

// `track()` calls the PostHog SDK which can throw if the transport
// fails to initialise (no network at boot, no key configured, etc.).
// Wrap every call so a busted analytics layer can't break critical
// flows like login/logout/post-create.
function safeTrack(track: ReturnType<typeof useTrack>, event: string, props?: Record<string, any>) {
  try { track(event, props); } catch {}
}

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
  const identify = useIdentify();
  const resetIdentity = useResetIdentity();
  const track = useTrack();
  const qc = useQueryClient();

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItem(TOKEN_KEY);
        if (token) {
          setToken(token);
          try {
            const me = await Auth.me();
            setUser(me.user);
          } catch (e: any) {
            // Distinguish a real 401 (stale token, server-side purge,
            // secret rotation) from a transient network failure. The
            // old code nuked the token on either path, which meant a
            // single dropped packet at boot on flaky Iraqi
            // connectivity logged the user out permanently. Now we
            // only delete on a clean 401; on a network error we keep
            // the token and try again next launch.
            if (e?.status === 401) {
              await SecureStore.deleteItem(TOKEN_KEY);
              setToken(null);
              // Fall back to a fresh guest so the app still works
              // without auth-gated screens — same as the no-token path.
              try {
                const r = await Auth.guest();
                await persist(r.token, r.user);
              } catch {}
            } else {
              // Network/server error — leave the token in place; the
              // next /auth/me call (post-refresh, post-foreground)
              // will recover automatically.
            }
          }
        } else {
          // No token yet — auto-create a guest session so every action
          // (post a listing, chat, save) just works without any auth UI.
          // Real signup is offered as an upgrade later.
          const r = await Auth.guest();
          await persist(r.token, r.user);
        }
      } catch {
        // Outer catch covers SecureStore/setToken failures. Don't nuke
        // any token here — the inner try already handled token-related
        // recovery.
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
    // Tie all subsequent PostHog events to this user. The `is_guest`
    // and `seller_type` traits become filterable in the dashboard
    // (e.g. "show DAU but only for real users", "show contact-rate
    // breakdown for shops vs individuals").
    if (!u.is_guest) {
      identify(u.id, {
        is_guest: u.is_guest,
        seller_type: u.seller_type,
        governorate: u.governorate,
        profile_completed: u.profile_completed,
      });
    }
  }, [identify]);

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
      // Server returns the same row whether this is a brand-new account
      // or a returning user. `profile_completed=false` is a strong
      // signal it's a fresh signup (the server's complete-profile flow
      // is the only thing that flips it to true).
      const isFreshSignup = !r.user.profile_completed;
      await persist(r.token, r.user);
      // `safeTrack` so a PostHog transport hiccup doesn't reject this
      // promise — the user is already logged in, the caller will pop
      // the modal, and anything that looks like a login failure here
      // would be confusing.
      safeTrack(track, isFreshSignup ? 'user.signup' : 'user.signin', { method: 'phone' });
    },
    [persist, track],
  );

  const refresh = useCallback(async () => {
    try {
      const me = await Auth.me();
      setUser(me.user);
    } catch {}
  }, []);

  const logout = useCallback(async () => {
    safeTrack(track, 'user.logout');
    resetIdentity();
    await SecureStore.deleteItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    // Wipe every React Query cache entry so the next user on the same
    // device doesn't briefly see the previous user's saved listings /
    // mine / chats flash on the screen. Without this the cache stays
    // alive in memory keyed by query-key alone, and after the new
    // user's token is set the first render still reads the stale data.
    qc.clear();
    // Drop the user on the phone-entry screen. Done centrally so any
    // logout button in the app produces the same redirect behavior.
    // (The original screen stays mounted underneath the modal — when
    // the user logs in via AuthGate it pops itself and we land back
    // on the Profile tab with `user` re-populated.)
    go('AuthGate');
  }, [track, resetIdentity, qc]);

  return <AuthCtx.Provider value={{ user, loading, refresh, login, register, phoneLogin, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
