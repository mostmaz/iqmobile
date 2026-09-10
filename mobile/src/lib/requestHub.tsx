// The request feature's two shared pieces of state, hoisted above the tabs.
//
// «اطلب جهاز» is a TAB that opens a sheet, not a screen — the handoff is
// explicit that there is no intermediate page — so the sheet cannot live
// inside any one stack. And the الطلبات badge has to agree with the line
// under the feed's own title, which means one fetch and one "last seen"
// timestamp rather than a copy per screen.
//
// Mounted inside MainTabs but OUTSIDE Tabs.Navigator, so `useNavigation()`
// here resolves to the ROOT stack, not to the tabs. Every navigate below is
// therefore written as the nested form through 'Main' — navigate() bubbles
// up to parents, it does not reach down into a child navigator, and the
// short forms («Requests», «Search») silently do nothing from up here.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { PhoneRequests, type RequestPulse } from '../api/endpoints';
import { RequestComposeSheet } from '../components/RequestComposeSheet';
import { GOV_AR_TO_EN, arOf } from './governorates';
import { useAuth } from '../auth/AuthContext';

const SEEN_KEY = 'requests.feedSeenAt';

type ComposeSeed = { brand?: string | null; model?: string };

type Hub = {
  pulse: RequestPulse | undefined;
  /** Stamp "I have looked at the feed" — the badge clears from here. */
  markFeedSeen: () => void;
  /** Open «اطلب جهازاً», optionally pre-filled with what they were looking at. */
  openCompose: (seed?: ComposeSeed) => void;
};

// A no-op default rather than a throw. The provider lives inside MainTabs, so
// anything rendered outside it (the auth gate, onboarding) would otherwise
// crash on a hook it has no use for anyway.
const Ctx = createContext<Hub>({ pulse: undefined, markFeedSeen: () => {}, openCompose: () => {} });

export const useRequestHub = () => useContext(Ctx);

export function RequestHubProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const isReal = !!user && !(user as any).is_guest;
  const govAr = arOf((user as any)?.governorate) || '';
  const govEn = govAr ? GOV_AR_TO_EN[govAr] : undefined;

  const [seed, setSeed] = useState<ComposeSeed | null>(null);
  // null = not read from disk yet. The pulse query waits for it, because
  // firing with since=0 first would flash the full day's count as "new" and
  // then correct itself a beat later.
  const [seenAt, setSeenAt] = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(SEEN_KEY)
      .then((v) => setSeenAt(Number(v) || 0))
      .catch(() => setSeenAt(0));
  }, []);

  const { data: pulse } = useQuery({
    queryKey: ['request-pulse', govEn ?? '', seenAt],
    queryFn: () => PhoneRequests.pulse({ governorate: govEn, since: seenAt || undefined }),
    enabled: seenAt !== null,
    staleTime: 60_000,
    // A city's demand moves in hours, not seconds. Five minutes keeps the
    // badge honest without making the tab bar a polling loop.
    refetchInterval: 5 * 60_000,
  });

  const markFeedSeen = useCallback(() => {
    const at = Date.now();
    setSeenAt(at);
    AsyncStorage.setItem(SEEN_KEY, String(at)).catch(() => {});
  }, []);

  const openCompose = useCallback((s?: ComposeSeed) => {
    // A guest has no phone number, so no seller could answer the request —
    // the server refuses it with guest_not_allowed. Send them to sign in
    // instead of opening a form that cannot be submitted.
    if (!isReal) { navigation.navigate('AuthGate'); return; }
    setSeed(s || {});
  }, [isReal, navigation]);

  const value = useMemo(() => ({ pulse, markFeedSeen, openCompose }), [pulse, markFeedSeen, openCompose]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <RequestComposeSheet
        visible={seed !== null}
        onClose={() => setSeed(null)}
        defaultGovAr={govAr}
        initialBrand={seed?.brand ?? null}
        initialModel={seed?.model ?? ''}
        onSeeAvailable={(brand, model) => {
          // The funnel, not free-text search: they have just picked an exact
          // catalogue brand and model, and the funnel's list step is the view
          // built for exactly that pair (with its condition rail and price
          // sort). Search would re-ask a question already answered.
          navigation.navigate('Main', {
            screen: 'Requests', params: { screen: 'RequestFunnel', params: { brand, model } },
          });
        }}
        onCreated={(created) => {
          setSeed(null);
          qc.invalidateQueries({ queryKey: ['requests-mine'] });
          qc.invalidateQueries({ queryKey: ['requests-board'] });
          qc.invalidateQueries({ queryKey: ['request-pulse'] });
          navigation.navigate('Main', {
            screen: 'Requests', params: { screen: 'RequestDetail', params: { id: created.id } },
          });
        }}
      />
    </Ctx.Provider>
  );
}
