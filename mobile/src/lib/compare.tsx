// The shortlist a buyer is deciding between.
//
// Iraqi buyers open four tabs of the same phone from four sellers and try to
// hold the differences in their head. This holds them instead: pick two or
// three listings, see them side by side with the spec sheet behind each.
//
// Entries carry a thumbnail and name, not just an id, so the tray above the
// tab bar can draw the shortlist immediately. Fetching three listings just
// to render three 44pt thumbnails would leave the tray blank on every cold
// start, which is exactly when the buyer needs to see what is in it.
//
// Capped at three. A fourth column stops being a comparison and starts being
// a spreadsheet — on a phone it would either scroll horizontally (so no two
// columns are visible together, which defeats the point) or squeeze every
// column past legibility.
//
// Persisted, because the shortlist is built over hours: a buyer adds one at
// lunch and the next in the evening, and an app restart in between must not
// throw the first one away.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const COMPARE_MAX = 3;
const KEY = 'iq_compare_v2';

export interface CompareEntry {
  id: number;
  brand?: string | null;
  model?: string | null;
  image_path?: string | null;
}

interface CompareCtx {
  entries: CompareEntry[];
  ids: number[];
  has: (id: number) => boolean;
  /** Returns false when the list is already full, so the caller can say so. */
  toggle: (entry: CompareEntry) => boolean;
  remove: (id: number) => void;
  clear: () => void;
  isFull: boolean;
}

const Ctx = createContext<CompareCtx>({
  entries: [], ids: [], has: () => false, toggle: () => false,
  remove: () => {}, clear: () => {}, isFull: false,
});

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<CompareEntry[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setEntries(
            parsed
              .filter((e) => e && Number.isInteger(e.id))
              .slice(0, COMPARE_MAX),
          );
        }
      })
      .catch(() => { /* unreadable store — start empty rather than crash */ });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(entries)).catch(() => {});
  }, [entries]);

  const toggle = useCallback((entry: CompareEntry) => {
    let accepted = true;
    setEntries((prev) => {
      if (prev.some((e) => e.id === entry.id)) return prev.filter((e) => e.id !== entry.id);
      if (prev.length >= COMPARE_MAX) { accepted = false; return prev; }
      return [...prev, entry];
    });
    return accepted;
  }, []);

  const value = useMemo<CompareCtx>(() => ({
    entries,
    ids: entries.map((e) => e.id),
    has: (id: number) => entries.some((e) => e.id === id),
    toggle,
    remove: (id: number) => setEntries((prev) => prev.filter((e) => e.id !== id)),
    clear: () => setEntries([]),
    isFull: entries.length >= COMPARE_MAX,
  }), [entries, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCompare = () => useContext(Ctx);
