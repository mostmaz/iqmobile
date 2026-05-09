// (intentionally minimal — keep zustand around for future cross-screen state.)
import { create } from 'zustand';

interface AppState {
  // unread chat indicator — incremented by NotificationBanner, cleared on chat enter
  unread: number;
  bumpUnread: () => void;
  clearUnread: () => void;
}

export const useApp = create<AppState>((set) => ({
  unread: 0,
  bumpUnread: () => set((s) => ({ unread: s.unread + 1 })),
  clearUnread: () => set({ unread: 0 }),
}));
