# Behaviour on a poor connection

The app is used on Iraqi mobile data, where the characteristic failure is not
"no signal" but **full bars and no working data path** — a stalled socket, a
captive portal, a carrier blackholing the route. Everything here is built
around that fact.

## Reachability is measured, not asked

`lib/reachabilityCore.ts` decides, `lib/reachability.ts` supplies the clock and
the socket. We deliberately do **not** use `@react-native-community/netinfo`:
it reports the radio, and the radio says "connected" throughout the failure we
actually care about. Instead every finished request reports its outcome
(`client.ts` → `setRequestOutcomeSink`), because every request is already a
measurement of whether `api.iqmobile.org` answers.

Two rules stop it flapping:

- **Only transport failures count.** An HTTP 500 is the server answering and a
  401 is it answering emphatically. Both mean online.
- **Two consecutive failures, not one.** Single requests fail constantly on a
  mobile link.

While offline, a `/health` probe runs on a climbing backoff (2s → 60s), reset
on foreground. The probe is not an optimisation — it is the only way back,
because once react-query is told it is offline it stops making the requests
whose success would prove otherwise.

## What is cached, and what is deliberately not

The query cache is persisted to AsyncStorage so listings already seen stay
readable with no connection. `lib/queryCachePolicy.ts` decides what may be
written, and it is a **privacy boundary, not a tuning knob**: the cache
outlives a sign-out, so anything keyed to the signed-in user (`me`, `chats`,
`messages`, `inbox`, `myListings`, `saved`, `orders`, …) stays in memory only.
Restoring one account's inbox under the next would be a leak.

`gcTime` must stay `>= maxAge`. React-query garbage-collects unused queries
after five minutes by default, which would collect exactly the entries the
persister then tries to restore, and the whole feature would silently no-op.

## Chat

A send becomes an **outbox entry first** and renders immediately as a pending
bubble. It leaves the outbox only when the server acknowledges it. A failure
is a state on the message — with its own retry and its own discard — not a
dialog, because a dialog cannot survive leaving the screen and the queue can.

Messages drain **one at a time, oldest first**: a conversation delivered out of
order is worse than one delivered late.

A send whose *response* was lost is the interesting case — the message really
did arrive, and a retry would post it twice. `isAcknowledged` spots it by
matching sender, exact body and a ten-minute window of the attempt. The window
is what keeps someone who genuinely asks «متوفر؟» twice in a week from losing
the second one.

## What this deliberately does **not** do

- **No offline queue for anything but chat text.** Listings, offers, images and
  edits still require a connection and say so. A queued listing would publish
  minutes later at a price the seller may have changed their mind about.
- **No "you are back online, here is what you missed" summary.** Reconnecting
  refetches quietly; interrupting someone to tell them the network recovered
  is noise.
- **No retry of mutations.** `retry: false` for all of them. Sending a message
  or creating a listing twice is worse than failing once; recovery is the
  outbox and the idempotency key, both deliberate.
- **No offline banner for a slow request.** It takes consecutive transport
  failures, so the banner appearing is a statement rather than a flicker.
- **The cache is not an offline mode.** Prices and availability go stale; we
  show what was last loaded and never claim it is current.
