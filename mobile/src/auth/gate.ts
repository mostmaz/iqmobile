// Tiny helper used by screens that have an "auth-required" action. When
// the user is logged in we just run the action; when they aren't we push
// the AuthGate modal so they can sign in / sign up. After they finish we
// don't auto-resume the action — the caller usually wants the user to
// re-tap once they see the screen they're on (e.g. the listing detail
// might have updated).
import { go } from '../navigation/ref';
import type { User } from '../api/endpoints';

export function requireUser(user: User | null, action: () => void, mode: 'login' | 'signup' = 'login') {
  if (user) { action(); return; }
  go('AuthGate', { mode });
}
