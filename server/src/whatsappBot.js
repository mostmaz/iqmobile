// Sending WhatsApp as 07502062804 from a linked session (Baileys).
//
// ── Read this before turning it on ──────────────────────────────────────
//
// This is an UNOFFICIAL client. It links to WhatsApp the way "linked
// devices" does and sends as the account itself, which is against
// WhatsApp's terms, and automated outbound to people who never wrote to you
// first is the single most ban-prone pattern there is. The number that gets
// banned is the business's, and the ban takes its chat history with it.
//
// The owner asked for this over the Cloud API knowing that. Everything below
// is therefore built to keep the send rate indistinguishable from a person
// typing: one message per 15-minute sweep (chatNudge.js), a random pause
// before each one, a check that the number is even on WhatsApp before
// writing to it, and text that varies between recipients rather than the
// same string a thousand times.
//
// WHATSAPP_PROVIDER=cloud switches to the official Meta path in one env var,
// with no other change: whatsapp.js dispatches, and the message text is
// generated the same way.
//
// ── The session ─────────────────────────────────────────────────────────
//
// Credentials live in server/data/wa-auth/. They are as sensitive as the
// phone: anyone holding them can send as this number. Gitignored, and they
// survive a deploy because `git reset --hard` does not remove untracked
// files. Linking is a one-time QR scan from the phone that owns the number
// (Settings → Linked devices), via GET /admin/whatsapp/qr.
//
// Baileys is imported dynamically so a server whose node_modules predate
// this file still boots — the whole feature simply reports itself
// unavailable rather than taking the API down with it.
import fs from 'node:fs';
import path from 'node:path';

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || path.resolve('./data/wa-auth');

let sock = null;
let starting = null;
let lastQr = null;        // the pairing string, until it is scanned or expires
let lastQrAt = 0;
let connection = 'idle';  // idle | connecting | open | close | logged_out | unavailable
let lastError = null;

/** Baileys wants a pino-shaped logger; this is the quietest valid one. */
const silent = {
  level: 'silent',
  child: () => silent,
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

/**
 * Is there a session on disk to reconnect with?
 *
 * This, not `linked`, is what "configured" means for the bot: the socket is
 * opened lazily by sendBotMessage, so asking whether it is open right now —
 * before anything has asked it to open — is a deadlock. It was one: every
 * send returned `unconfigured` after a deploy, because nothing reconnected
 * and nothing could, since the guard ran before the code that connects.
 */
export function botLinkable() {
  try {
    return fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).some((f) => f.startsWith('creds'));
  } catch { return false; }
}

export function botStatus() {
  return {
    connection,
    linked: connection === 'open',
    linkable: botLinkable(),
    // A QR older than a minute has already expired on WhatsApp's side; say
    // so rather than showing a code that cannot work.
    qr_available: !!lastQr && Date.now() - lastQrAt < 60_000,
    auth_dir_exists: fs.existsSync(AUTH_DIR),
    last_error: lastError,
  };
}

/** The current pairing string, or null. The admin route renders it as a QR. */
export function botQr() {
  if (!lastQr || Date.now() - lastQrAt > 60_000) return null;
  return lastQr;
}

/**
 * Connect, or return the live socket.
 *
 * Never throws: a WhatsApp session that cannot come up must not be able to
 * fail a request or a sweep.
 */
export async function startBot() {
  if (sock && connection === 'open') return sock;
  if (starting) return starting;

  starting = (async () => {
    try {
      const baileys = await import('@whiskeysockets/baileys');
      const makeWASocket = baileys.default || baileys.makeWASocket;
      const { useMultiFileAuthState, DisconnectReason } = baileys;

      fs.mkdirSync(AUTH_DIR, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

      connection = 'connecting';
      const s = makeWASocket({
        auth: state,
        logger: silent,
        // Identifies the linked device in the phone's "Linked devices" list,
        // so the owner can see what this is and unlink it there.
        browser: ['iQ Mobile', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      s.ev.on('creds.update', saveCreds);
      s.ev.on('connection.update', (u) => {
        if (u.qr) { lastQr = u.qr; lastQrAt = Date.now(); }
        if (u.connection) connection = u.connection;
        if (u.connection === 'open') { lastQr = null; lastError = null; console.log('[whatsapp-bot] linked'); }
        if (u.connection === 'close') {
          const code = u.lastDisconnect?.error?.output?.statusCode;
          const loggedOut = code === DisconnectReason?.loggedOut;
          lastError = loggedOut ? 'logged_out' : `closed_${code ?? 'unknown'}`;
          connection = loggedOut ? 'logged_out' : 'close';
          sock = null;
          console.warn('[whatsapp-bot] connection closed:', lastError);
          // Reconnect unless the phone unlinked us — retrying a logged-out
          // session forever is how a number gets flagged.
          if (!loggedOut) setTimeout(() => { startBot().catch(() => {}); }, 15_000);
        }
      });

      sock = s;
      return s;
    } catch (e) {
      connection = 'unavailable';
      lastError = String(e?.message || e).slice(0, 200);
      console.error('[whatsapp-bot] start failed:', lastError);
      return null;
    } finally {
      starting = null;
    }
  })();

  return starting;
}

/** Wipe the session so a different number (or a re-scan) can link. */
export function unlinkBot() {
  try { sock?.end?.(undefined); } catch { /* already gone */ }
  sock = null;
  connection = 'idle';
  lastQr = null;
  try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch { /* nothing to remove */ }
}

/** Wait for the socket to be usable, up to `ms`. Returns true if it is. */
async function waitOpen(ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (sock && connection === 'open') return true;
    if (connection === 'logged_out' || connection === 'unavailable') return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Send one message.
 *
 * Returns { ok, outcome, detail } and never throws.
 * outcome: sent | not_linked | not_on_whatsapp | rejected
 */
export async function sendBotMessage(e164, text) {
  await startBot();
  if (!(await waitOpen())) {
    return { ok: false, outcome: 'not_linked', detail: connection };
  }

  const digits = String(e164).replace(/\D/g, '');
  try {
    // Asking first costs one round trip and avoids writing into the void —
    // and a burst of sends to numbers with no WhatsApp is itself a signal
    // that this is automated.
    const [probe] = await sock.onWhatsApp(digits);
    if (!probe?.exists) return { ok: false, outcome: 'not_on_whatsapp' };

    // A human pause. The sweep already spaces messages 15 minutes apart;
    // this keeps the ones that do go out from landing on a metronome.
    await new Promise((r) => setTimeout(r, 1500 + Math.random() * 4000));

    const res = await sock.sendMessage(probe.jid, { text });
    return { ok: true, outcome: 'sent', detail: res?.key?.id };
  } catch (e) {
    const detail = String(e?.message || e).slice(0, 160);
    console.warn('[whatsapp-bot] send failed:', detail);
    return { ok: false, outcome: 'rejected', detail };
  }
}
