// What may be written to disk, and why most of it may not.
//
// The persisted query cache survives a sign-out and even a change of user on
// a shared phone, which makes this list a privacy boundary rather than a
// tuning knob. Anything keyed to the signed-in user stays in memory only:
// restoring the previous account's inbox under the next one would be a real
// leak, not a stale-data annoyance.
//
// Public browsing data is the opposite case and the whole point of the
// feature — listings the user already saw should still be there on the metro.
//
// No imports on purpose: this is the pure half, so `node --test` can load it
// without React Native.

const PRIVATE_KEYS = [
  'me', 'chat', 'chats', 'messages', 'inbox', 'notifications', 'mine',
  'myListings', 'saved', 'orders', 'cart', 'requests-mine', 'offers',
];

/**
 * `true` if this query key is safe to persist.
 *
 * Matches the whole first segment or a `-`/`/` separated prefix of it —
 * `chats-unread` is as much the user's as `chats`, while `minerals` is not
 * `mine` and a bare `startsWith` would have swallowed it.
 */
export function shouldPersistQuery(key: readonly unknown[]): boolean {
  const head = String(key?.[0] ?? '');
  return !PRIVATE_KEYS.some(
    (p) => head === p || head.startsWith(`${p}-`) || head.startsWith(`${p}/`),
  );
}
