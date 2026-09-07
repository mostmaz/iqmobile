// Messages the user has sent that the server has not accepted yet.
//
// What was already right: ChatScreen clears the input only after the await
// resolves, so a failed send never eats the typed text. What was missing is
// everything after that moment — on a slow link, tapping إرسال did nothing
// visible for up to twenty seconds, and navigating away lost the attempt with
// no trace. A user on Iraqi mobile data reasonably concluded the app was
// broken and typed it again.
//
// So: every send becomes an outbox entry first and is rendered immediately as
// a pending bubble. The entry leaves the outbox only when the server has
// acknowledged it. A failure is a state, not a dialog — the message stays on
// screen marked failed, with a retry on that one message.
//
// Pure on purpose (no storage, no React): the ordering and dedupe rules below
// are the part worth testing, and they are the part that was never written.

export type OutboxState = 'pending' | 'failed';

export interface OutboxEntry {
  /** Client-generated; the identity of an attempt across retries and restarts. */
  key: string;
  chat_id: number;
  body: string;
  created_at: number;
  state: OutboxState;
  /** Attempts made so far — for backoff and for giving up honestly. */
  tries: number;
  /** Our error code from client.ts, kept so the UI can be specific. */
  error?: string | null;
}

/** Beyond this, a queued message is stale enough that sending it would surprise. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Per chat. A runaway queue is a bug; capping it stops it becoming a data loss. */
export const MAX_PER_CHAT = 50;

export function newKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Add an attempt. Same key twice is the same attempt, not two. */
export function enqueue(list: OutboxEntry[], entry: OutboxEntry): OutboxEntry[] {
  if (list.some((e) => e.key === entry.key)) return list;
  const next = [...list, entry];
  // Drop the OLDEST past the cap: the newest messages are the ones the user
  // is still looking at and still expects to go.
  const perChat = next.filter((e) => e.chat_id === entry.chat_id);
  if (perChat.length <= MAX_PER_CHAT) return next;
  const cut = new Set(
    perChat.slice(0, perChat.length - MAX_PER_CHAT).map((e) => e.key),
  );
  return next.filter((e) => !cut.has(e.key));
}

export function remove(list: OutboxEntry[], key: string): OutboxEntry[] {
  return list.filter((e) => e.key !== key);
}

export function mark(
  list: OutboxEntry[],
  key: string,
  state: OutboxState,
  error?: string | null,
): OutboxEntry[] {
  return list.map((e) => (e.key === key
    ? { ...e, state, error: error ?? null, tries: state === 'failed' ? e.tries + 1 : e.tries }
    : e));
}

/** Anything too old to still be worth sending. */
export function prune(list: OutboxEntry[], now: number): OutboxEntry[] {
  return list.filter((e) => now - e.created_at < MAX_AGE_MS);
}

export function forChat(list: OutboxEntry[], chatId: number): OutboxEntry[] {
  return list.filter((e) => e.chat_id === chatId);
}

/**
 * What to send when the connection returns.
 *
 * Only ever one chat's worth at a time and in the order they were typed —
 * firing a whole queue in parallel would deliver a conversation out of order,
 * which is worse than delivering it late.
 */
export function nextToSend(list: OutboxEntry[], chatId: number): OutboxEntry | null {
  const mine = forChat(list, chatId).sort((a, b) => a.created_at - b.created_at);
  return mine[0] ?? null;
}

/**
 * Has the server caught up with this attempt?
 *
 * The send endpoint does not echo our key back, so after a retry whose
 * response was lost the same text can arrive twice — once really sent, once
 * still queued. Matching on (sender, exact body, within a window of the
 * attempt) is how we notice, and the window is what keeps a user who
 * genuinely types «متوفر؟» twice an hour apart from losing the second one.
 */
export function isAcknowledged(
  entry: OutboxEntry,
  serverMessages: { sender_id: number; body?: string | null; created_at: number }[],
  meId: number,
  windowMs = 10 * 60 * 1000,
): boolean {
  return serverMessages.some(
    (m) => m.sender_id === meId
      && (m.body ?? '') === entry.body
      && Math.abs(m.created_at - entry.created_at) < windowMs,
  );
}
