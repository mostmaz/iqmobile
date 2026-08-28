// The shortlist a buyer is deciding between.
//
// Iraqi buyers open four tabs of the same phone from four sellers and try to
// hold the differences in their head. This holds them instead: pick two or
// three listings, see them side by side with the spec sheet behind each.
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
const KEY = 'iq_compare_v1';

interface CompareCtx {
  ids: number[];
  has: (id: number) => boolean;
  /** Returns false when the list is already full, so the caller can say so. */
  toggle: (id: number) => boolean;
  remove: (id: number) => void;
  clear: () => void;
  isFull: boolean;
}

const Ctx = createContext<CompareCtx>({
  ids: [], has: () => false, toggle: () => false, remove: () => {}, clear: () => {}, isFull: false,
});

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [ids, setIds] = useState<number[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setIds(parsed.filter((n) => Number.isInteger(n)).slice(0, COMPARE_MAX));
        }
      })
      .catch(() => { /* unreadable store — start empty rather than crash */ });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(ids)).catch(() => {});
  }, [ids]);

  const toggle = useCallback((id: number) => {
    let accepted = true;
    setIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= COMPARE_MAX) { accepted = false; return prev; }
      return [...prev, id];
    });
    return accepted;
  }, []);

  const value = useMemo<CompareCtx>(() => ({
    ids,
    has: (id: number) => ids.includes(id),
    toggle,
    remove: (id: number) => setIds((prev) => prev.filter((x) => x !== id)),
    clear: () => setIds([]),
    isFull: ids.length >= COMPARE_MAX,
  }), [ids, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCompare = () => useContext(Ctx);
