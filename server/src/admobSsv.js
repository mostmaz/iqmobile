// Verifying that Google, not a seller with curl, says the ad was watched.
//
// AdMob's server-side verification calls our endpoint as a GET whose query
// string is signed with ECDSA over the secp256k1 curve. The signed bytes are
// everything BEFORE `&signature=` — so the string has to be verified as it
// arrived, not as Express parsed and re-encoded it. `req.originalUrl` is the
// only faithful copy; `req.query` has already lost the ordering and the exact
// escaping, and re-serialising it produces a different byte string and a
// signature that never matches.
//
// Without this the whole feature is an open endpoint that grants promotion to
// anyone who can spell the URL. The client is never trusted to say "I watched
// it" — the app's own reward callback only tells it when to start polling.
//
// Keys come from Google and rotate. They are fetched once, cached, and
// re-fetched when a callback arrives carrying a key_id we do not know, which
// is exactly when a rotation has happened and the only moment a refresh is
// worth a network round trip.

import crypto from 'node:crypto';

const KEY_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const REFETCH_COOLDOWN_MS = 60 * 1000;   // don't let a bad key_id become a DoS
const MAX_SKEW_MS = 10 * 60 * 1000;      // a replayed callback goes stale

let cache = { at: 0, keys: new Map() };
let lastFetchAttempt = 0;

/** Exposed for tests, which inject keys rather than reaching the network. */
export function _setKeysForTest(entries) {
  cache = { at: Date.now(), keys: new Map(entries) };
}

async function fetchKeys() {
  const res = await fetch(KEY_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`verifier_keys_http_${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const k of body?.keys || []) {
    // `pem` is an EC public key; `base64` is the same key DER-encoded.
    if (k?.keyId != null && k?.pem) keys.set(String(k.keyId), String(k.pem));
  }
  if (!keys.size) throw new Error('verifier_keys_empty');
  cache = { at: Date.now(), keys };
  return keys;
}

async function keyFor(keyId) {
  if (cache.keys.has(keyId)) return cache.keys.get(keyId);
  // Unknown id: either a rotation, or someone guessing. The cooldown keeps
  // the second case from turning into a request amplifier against gstatic.
  if (Date.now() - lastFetchAttempt < REFETCH_COOLDOWN_MS) return null;
  lastFetchAttempt = Date.now();
  try { await fetchKeys(); } catch (e) { console.warn('[admob] key fetch failed:', e?.message || e); }
  return cache.keys.get(keyId) || null;
}

/**
 * Split a raw callback URL into the signed portion and its parameters.
 *
 * Returns null when the URL is not shaped like an SSV callback at all, which
 * is most of what an open endpoint receives.
 */
export function parseCallback(originalUrl) {
  const qIndex = originalUrl.indexOf('?');
  if (qIndex < 0) return null;
  const query = originalUrl.slice(qIndex + 1);
  const marker = query.indexOf('signature=');
  if (marker <= 0) return null;
  // Everything before `&signature=` is what Google signed.
  const signedPortion = query.slice(0, marker - 1);
  const params = new URLSearchParams(query);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) return null;
  return {
    signedPortion,
    signature,
    keyId,
    transactionId: params.get('transaction_id'),
    customData: params.get('custom_data'),
    userId: params.get('user_id'),
    adUnit: params.get('ad_unit'),
    timestamp: Number(params.get('timestamp')) || 0,
  };
}

function b64urlToBuffer(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * @returns `{ ok: true, data }` or `{ ok: false, reason }`. Never throws — a
 *          malformed callback is a normal event on a public endpoint.
 */
export async function verifyCallback(originalUrl, now = Date.now()) {
  const parsed = parseCallback(originalUrl);
  if (!parsed) return { ok: false, reason: 'malformed' };

  // AdMob's timestamp is in MICROseconds. A callback older than the skew
  // window is a replay of a URL someone kept, and the transaction-id index
  // would catch it anyway — this just rejects it more cheaply.
  const tsMs = parsed.timestamp > 1e14 ? Math.floor(parsed.timestamp / 1000) : parsed.timestamp;
  if (!tsMs || Math.abs(now - tsMs) > MAX_SKEW_MS) return { ok: false, reason: 'stale' };

  const pem = await keyFor(parsed.keyId);
  if (!pem) return { ok: false, reason: 'unknown_key' };

  let ok = false;
  try {
    ok = crypto.createVerify('SHA256')
      .update(parsed.signedPortion)
      .verify(pem, b64urlToBuffer(parsed.signature));
  } catch (e) {
    return { ok: false, reason: 'verify_error' };
  }
  if (!ok) return { ok: false, reason: 'bad_signature' };
  if (!parsed.transactionId) return { ok: false, reason: 'no_transaction_id' };
  return { ok: true, data: parsed };
}

/** Warm the cache at boot so the first real reward isn't the first fetch. */
export function warmAdmobKeys() {
  fetchKeys().catch((e) => console.warn('[admob] key warm failed:', e?.message || e));
}
