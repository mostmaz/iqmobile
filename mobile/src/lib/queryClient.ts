// One QueryClient, configured for Iraqi mobile data, and persisted to disk.
//
// App.tsx used to say `new QueryClient()` with no options at all, which means
// react-query's browser defaults: three retries with exponential backoff, and
// a cache that evaporates the moment the process dies. On this network that
// produced two bad behaviours — a dead connection burned four full 20s
// deadlines before failing (over a minute of spinner), and reopening the app
// on the metro showed empty screens even though the same listings had been on
// screen ninety seconds earlier.
//
// The single most important line in this file is gcTime. The persister writes
// the cache to AsyncStorage, but react-query garbage-collects unused queries
// after five minutes by default — so on a cold start it would restore
// entries that had already been collected and hand back nothing. gcTime must
// be at least the persister's maxAge or the whole feature silently no-ops.

import { QueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { isUnreachableError } from './reachabilityCore';

/** How long a restored cache is still worth showing. */
export const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Two, not three. Each attempt can cost a full 20s deadline, and a
      // fourth try helps nobody who is actually offline — it only delays the
      // moment we can say so.
      retry: (failureCount, error) => {
        // A 4xx is an answer. Asking again produces the same answer more
        // slowly; only transport failures are worth retrying.
        if (!isUnreachableError(error)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      // Lifted from BrowseScreen, the one query already tuned for this
      // network. Data stays fresh for a minute so navigating back to a list
      // is instant rather than a refetch on a slow link.
      staleTime: 60_000,
      gcTime: CACHE_MAX_AGE,
      // The default refetches on every screen focus, which on a slow link
      // replaces readable stale content with a spinner. Let staleTime decide.
      refetchOnWindowFocus: false,
      // No point firing a request we know cannot leave the device; react-query
      // reads this from onlineManager, which reachability.ts drives.
      networkMode: 'online',
    },
    mutations: {
      // Never silently retry a mutation. Sending the same chat message or
      // creating the same listing twice is worse than failing once — the
      // outbox and the idempotency key handle recovery deliberately instead.
      retry: false,
    },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'iq_query_cache_v1',
  // Writing the whole cache on every change would thrash storage on a feed
  // that updates as you scroll.
  throttleTime: 2000,
});

export { shouldPersistQuery } from './queryCachePolicy';
