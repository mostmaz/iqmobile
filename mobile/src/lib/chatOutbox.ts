// The outbox, persisted and shared. Rules live in chatOutboxCore.ts.
//
// A module-level store rather than context: the drain loop has to keep
// running while the user is on another screen — that is the whole point of
// queueing — and a provider unmounts with the chat.

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type OutboxEntry, enqueue, remove, mark, prune, forChat, nextToSend, newKey,
} from './chatOutboxCore';

const KEY = 'iq_chat_outbox_v1';

let list: OutboxEntry[] = [];
// The `ready` gate from cart.tsx:66-81. Without it the empty initial state is
// written over the stored queue before the load finishes, and the messages we
// promised to keep are gone on the launch that most needed them.
let ready = false;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

function save() {
  if (!ready) return;
  AsyncStorage.setItem(KEY, JSON.stringify(list)).catch(() => {});
}

function set(next: OutboxEntry[]) { list = next; save(); emit(); }

export const outboxReady = AsyncStorage.getItem(KEY)
  .then((raw) => { if (raw) list = prune(JSON.parse(raw), Date.now()); })
  .catch(() => {})
  .finally(() => { ready = true; save(); emit(); });

export function getOutbox(chatId: number) { return forChat(list, chatId); }
export function peekNext(chatId: number) { return nextToSend(list, chatId); }

export function queueMessage(chatId: number, body: string): OutboxEntry {
  const entry: OutboxEntry = {
    key: newKey(), chat_id: chatId, body, created_at: Date.now(),
    state: 'pending', tries: 0, error: null,
  };
  set(enqueue(list, entry));
  return entry;
}

export function markSent(key: string) { set(remove(list, key)); }
export function markFailed(key: string, error?: string | null) {
  set(mark(list, key, 'failed', error));
}
export function markPending(key: string) { set(mark(list, key, 'pending', null)); }
export function drop(key: string) { set(remove(list, key)); }

export function subscribeOutbox(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The queued messages for one chat, re-rendering as they change. */
export function useOutbox(chatId: number): OutboxEntry[] {
  const [, bump] = useState(0);
  useEffect(() => subscribeOutbox(() => bump((n) => n + 1)), []);
  return forChat(list, chatId);
}
