import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Auth, type User } from '../api/endpoints';
import { setToken } from '../api/client';
import * as SecureStore from '../lib/secureStore';
import { go } from '../navigation/ref';
import { useIdentify, useResetIdentity, useTrack } from '../analytics/track';
import { logMetaEvent } from '../analytics/meta';
import { ar } from '../i18n/ar';

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
  // Passwordless phone entry. Returns whether the server queued an OTP:
  // if `otpRequired`, the caller must collect the code and call
  // `otpVerify` to complete sign-in. If false, the token was persisted
  // and the caller can navigate as if sign-in succeeded.
  phoneLogin: (phone: string, channel?: 'sms' | 'whatsapp') =>
    Promise<{ otpRequired: boolean; channel?: 'sms' | 'whatsapp' }>;
  otpVerify: (phone: string, code: string) => Promise<void>;
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
            // Distinguish three failure modes:
            //   - 403 `user_suspended` — admin suspended this account.
            //     Nuke the token, fall back to a fresh guest session so
            //     the user can keep browsing / sign in as someone else,
            //     and surface an Arabic banner via the auth-error path.
            //   - 401 unauthorized — stale token, server-side purge,
            //     or secret rotation. Same recovery path (new guest)
            //     but no banner.
            //   - Anything else (network error) — leave the token in
            //     place and try again next launch. Critical fix from
            //     earlier: a single dropped packet at boot on flaky
            //     Iraqi connectivity used to log users out forever.
            if (e?.status === 403 && e?.message === 'user_suspended') {
              await SecureStore.deleteItem(TOKEN_KEY);
              setToken(null);
              try {
                const r = await Auth.guest();
                await persist(r.token, r.user);
              } catch {}
              // Alert imported at the top — surface the suspension
              // message in Arabic. User can still browse as a fresh
              // guest after dismissing.
              Alert.alert('حساب معلّق', (ar.errors as any).user_suspended);
            } else if (e?.status === 401) {
              await SecureStore.deleteItem(TOKEN_KEY);
              setToken(null);
              try {
                const r = await Auth.guest();
                await persist(r.token, r.user);
              } catch {}
            } else {
              // Network/server error — keep the token; next /auth/me
              // (post-refresh, post-foreground) will recover.
            }
          }
        } else {
          // No token yet — auto-create a guest session so every action
          // (post a listing, chat, save) just works without any auth UI.
          // Real signup is offered as an upgrade later.
          //
          // Retry with backoff if the call fails: a flaky network at
          // boot used to drop the user into a no-token state, and every
          // subsequent API call returned 401 → "يجب تسجيل الدخول للمتابعة"
          // even though the user never explicitly logged out. We'd
          // rather sit on the loading screen a few extra seconds than
          // hand the user a broken app.
          let backoff = 1000;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const r = await Auth.guest();
              await persist(r.token, r.user);
              break;
            } catch {
              if (attempt === 4) throw new Error('guest_provision_failed');
              await new Promise((resolve) => setTimeout(resolve, backoff));
              backoff = Math.min(backoff * 2, 8000);
            }
          }
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
    async (phone: string, channel?: 'sms' | 'whatsapp') => {
      const r = await Auth.phoneLogin(phone, channel);
      // OTP path — server sent a code and is waiting for verify. The
      // account isn't upserted yet; nothing to persist.
      if (r.otp_required) return { otpRequired: true as const, channel: r.channel };
      // Legacy path — server upserted + issued a token immediately.
      if (r.token && r.user) {
        const isFreshSignup = !r.user.profile_completed;
        await persist(r.token, r.user);
        safeTrack(track, isFreshSignup ? 'user.signup' : 'user.signin', { method: 'phone' });
        if (isFreshSignup) logMetaEvent('CompleteRegistration', { method: 'phone' });
        return { otpRequired: false as const };
      }
      throw new Error('network');
    },
    [persist, track],
  );

  const otpVerify = useCallback(
    async (phone: string, code: string) => {
      const r = await Auth.otpVerify(phone, code);
      const isFreshSignup = !r.user.profile_completed;
      await persist(r.token, r.user);
      safeTrack(track, isFreshSignup ? 'user.signup' : 'user.signin', { method: 'phone_otp' });
      if (isFreshSignup) logMetaEvent('CompleteRegistration', { method: 'phone_otp' });
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
    // Immediately spin up a fresh guest session so dismissing AuthGate
    // doesn't strand the user in a no-token state — without this, any
    // API call (chat, save, listing detail) after dismissal returns
    // 401 → "يجب تسجيل الدخول للمتابعة". Same pattern as the initial
    // boot path. Errors are swallowed; AuthGate is the next UI either way.
    try {
      const r = await Auth.guest();
      await persist(r.token, r.user);
    } catch {}
    // Drop the user on the phone-entry screen. Done centrally so any
    // logout button in the app produces the same redirect behavior.
    // (The original screen stays mounted underneath the modal — when
    // the user logs in via AuthGate it pops itself and we land back
    // on the Profile tab with `user` re-populated.)
    go('AuthGate');
  }, [track, resetIdentity, qc, persist]);

  return <AuthCtx.Provider value={{ user, loading, refresh, login, register, phoneLogin, otpVerify, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
