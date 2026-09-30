// One way out to WhatsApp, three transports behind it.
//
//   bot   (default) — a linked session sending as 07502062804. Unofficial,
//                     against WhatsApp's terms, and the ban risk is the
//                     business's own number. See whatsappBot.js.
//   cloud           — Meta's official Cloud API on an approved UTILITY
//                     template. Switch with WHATSAPP_PROVIDER=cloud; nothing
//                     else changes.
//   arqam           — the OTP vendor's template endpoint. Their docs are
//                     behind a dashboard login, so this path is a best-effort
//                     guess and is not a default.
//
// Callers pass FACTS (who, which device, how many are waiting) and never a
// string: the bot sends free text and the two template transports send
// numbered parameters, and only this file knows which.
//
// ── The template, for the cloud/arqam path ──────────────────────────────
//
//   name:     unanswered_chat
//   category: UTILITY   (a marketing template to someone who never opted in
//                        is what gets a WhatsApp account restricted)
//   language: ar
//   body:     مرحباً {{1}}، عندك رسالة على iQ Mobile بخصوص {{2}} من ٢٤ ساعة
//             وما انفتحت بعد. افتح التطبيق للرد.
//
// Not «رسالة من مشتري»: the sweep follows the unread message whichever side
// it is on, so the same text also reaches a buyer waiting on a seller's
// answer. Naming the wrong role would read as a mistake.
//
// {{1}} = the recipient's name, {{2}} = the device. Change the ORDER or
// COUNT here and in chatNudge.js together — Meta rejects a mismatch by
// delivering nothing.
//
// ── For the cloud path only, before anything can send ───────────────────
//
// A Meta Business account with a WABA and +9647502062804 registered ON it —
// THE NUMBER CANNOT BE IN BOTH PLACES, so registering it removes it from the
// WhatsApp app on the phone and its history goes with it. Then a permanent
// access token from a System user (the developer console's expires in 24h
// and would strand the sweep silently), then WHATSAPP_PHONE_NUMBER_ID and
// WHATSAPP_TOKEN in the env.
import { toE164 } from './iraqiPhone.js';
import { sendBotMessage, botStatus } from './whatsappBot.js';

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'bot').toLowerCase();

// ── Meta Cloud API ──
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TOKEN = process.env.WHATSAPP_TOKEN || '';
const TEMPLATE = process.env.WHATSAPP_TEMPLATE || 'unanswered_chat';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'ar';

// ── ARQAM fallback ──
const ARQAM_KEY = process.env.ARQAM_API_KEY || '';
const ARQAM_BASE = (process.env.ARQAM_BASE_URL || 'https://otp.arqam.tech/api').replace(/\/+$/, '');
const ARQAM_TEMPLATE = process.env.ARQAM_UTILITY_TEMPLATE || '';
const ARQAM_PATH = process.env.ARQAM_UTILITY_PATH || '/sms/send';

const TIMEOUT_MS = 15000;

/** Can this send at all? False means the sweep records `unconfigured` and stops. */
export function utilityConfigured() {
  if (PROVIDER === 'bot') return botStatus().linked;
  if (PROVIDER === 'arqam') return !!ARQAM_KEY && !!ARQAM_TEMPLATE;
  return !!PHONE_NUMBER_ID && !!TOKEN;
}

/** Which transport is live, for the dashboard to show rather than guess. */
export function utilityProvider() {
  return {
    provider: PROVIDER,
    configured: utilityConfigured(),
    template: PROVIDER === 'cloud' ? TEMPLATE : PROVIDER === 'arqam' ? ARQAM_TEMPLATE : null,
    bot: PROVIDER === 'bot' ? botStatus() : undefined,
  };
}

/**
 * The Cloud API body. Isolated because every field here is a thing Meta can
 * reject the whole message over.
 *
 * `to` carries no '+': the docs use bare digits, and both forms are accepted,
 * so this picks the one their examples use.
 */
export function buildCloudBody(to, params) {
  return {
    messaging_product: 'whatsapp',
    to: to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: TEMPLATE,
      language: { code: TEMPLATE_LANG },
      components: [{
        type: 'body',
        parameters: params.map((text) => ({ type: 'text', text: String(text) })),
      }],
    },
  };
}

export function buildArqamBody(to, params) {
  return { phoneNumber: to, templateName: ARQAM_TEMPLATE, parameters: params };
}

/**
 * What the bot actually types.
 *
 * ── Why this is built out of parts ─────────────────────────────────────
 *
 * A thousand byte-identical messages leaving one number is the clearest
 * signal there is that a human is not typing them, and it is the signal
 * WhatsApp's spam detection is looking for. So the text is assembled from
 * four openings, four ways of stating the fact and four closings — 64
 * distinct messages before the device name and the waiting count are even
 * substituted in.
 *
 * ── ...and why the choice is a hash, not a random ───────────────────────
 *
 * Picked from the RECIPIENT's id, so one person always gets exactly the same
 * wording. If it were random, a resend would arrive rephrased, which reads
 * as a second careless message rather than the same one — and the whole
 * point of the once-per-listing ledger is that it never looks like a chase.
 *
 * Each part is hashed with its own salt, so consecutive user ids do not walk
 * the three lists in lockstep and hand neighbouring sellers the same
 * combination.
 */
const OPENINGS = [
  (n) => `مرحباً ${n} 👋`,
  (n) => `السلام عليكم ${n}`,
  (n) => `هلا ${n}`,
  (n) => `هلا بيك ${n}`,
];

const FACTS = [
  (d) => `عندك رسالة على iQ Mobile بخصوص ${d} من ٢٤ ساعة وما انفتحت بعد.`,
  (d) => `وصلتك رسالة على تطبيق iQ Mobile بخصوص ${d} من أمس، وبعدها ما انقرأت.`,
  (d) => `أحد راسلك على iQ Mobile يسأل عن ${d}، وصار لها يوم ما انفتحت.`,
  (d) => `من يوم وأكو رسالة تنتظرك على iQ Mobile بخصوص ${d}.`,
];

const CLOSINGS = [
  'افتح التطبيق وردّ عليه قبل ما يشتري من غيره.',
  'ادخل التطبيق وردّ — الزبون ينتظر.',
  'افتح iQ Mobile وشوفها، الرد السريع يفرق بالبيع.',
  'ردّ عليه من التطبيق حتى ما تضيع الصفقة.',
];

/**
 * FNV-1a plus MurmurHash3's finalizer. Small, stable, and not tied to any
 * Node version's own hashing.
 *
 * The finalizer is not decoration. Plain FNV-1a barely mixes its LOW bits,
 * and `% 4` reads exactly those: without it, ids 1–8 produced four messages
 * repeating with period four, and the three lists walked in lockstep no
 * matter what the salt was. The point of this function is variety, so a hash
 * that is only varied in bits nobody reads is no hash at all.
 */
function pick(list, userId, salt) {
  const s = `${salt}:${userId}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return list[(h >>> 0) % list.length];
}

/** The rest of the message is in Arabic-Indic digits; the count has to match. */
const arNum = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);

/**
 * Arabic counts the way Arabic counts: two is a dual word, three to ten take
 * the plural, eleven and up take the singular. Getting this wrong is the
 * kind of thing a reader notices instantly and a template never survives.
 */
export function waitingPhrase(n) {
  if (n <= 1) return '';
  if (n === 2) return ' وعندك محادثتين تنتظران ردك.';
  if (n <= 10) return ` وعندك ${arNum(n)} محادثات تنتظر ردك.`;
  return ` وعندك ${arNum(n)} محادثة تنتظر ردك.`;
}

export function botText({ name, device, waiting = 1, userId = 0 }) {
  const id = Number(userId) || 0;
  const who = name ? pick(OPENINGS, id, 'open')(name) : pick(OPENINGS, id, 'open')('').trim();
  const fact = pick(FACTS, id, 'fact')(device || 'جهازك');
  const close = pick(CLOSINGS, id, 'close');
  return `${who}\n${fact}${waitingPhrase(waiting)}\n${close}`;
}

export async function sendWhatsApp(phone, facts, { dryRun = true } = {}) {
  const params = [facts.name || 'صاحب المتجر', facts.device || 'جهازك'];

  if (!utilityConfigured()) return { ok: false, outcome: 'unconfigured' };

  const to = toE164(phone);
  if (!to) return { ok: false, outcome: 'bad_phone' };

  if (dryRun) {
    // The point of the dry run: prove the selection is right, against real
    // production rows, before one message reaches a real person.
    const preview = PROVIDER === 'bot' ? botText(facts).replace(/\n/g, ' | ') : JSON.stringify(params);
    console.log(`[whatsapp][dry-run] ${PROVIDER} → ${to} :: ${preview}`);
    return { ok: true, outcome: 'dry_run' };
  }

  if (PROVIDER === 'bot') return sendBotMessage(to, botText(facts));

  if (PROVIDER === 'arqam') {
    const r = await post(`${ARQAM_BASE}${ARQAM_PATH}`, { 'X-API-Key': ARQAM_KEY }, buildArqamBody(to, params));
    if (r.transport) return { ok: false, outcome: 'transport', detail: r.transport };
    // ARQAM answer 200 for business failures too (see otp.js), so the HTTP
    // status alone is not the verdict.
    if (!r.ok || r.data?.success === false || r.data?.error) {
      const detail = String(r.data?.message || r.data?.error || `http_${r.httpStatus}`).slice(0, 200);
      console.warn('[whatsapp] arqam rejected:', detail);
      return { ok: false, outcome: 'rejected', detail };
    }
    return { ok: true, outcome: 'sent', detail: r.data?.messageId ? String(r.data.messageId) : undefined };
  }

  const r = await post(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    { authorization: `Bearer ${TOKEN}` },
    buildCloudBody(to, params),
  );
  if (r.transport) return { ok: false, outcome: 'transport', detail: r.transport };
  if (!r.ok || r.data?.error) {
    // Meta's message is the only useful part; the code tells the operator
    // whether it is their token (190), their template (132xxx) or the
    // recipient (131xxx).
    const e = r.data?.error || {};
    const detail = `${e.code ?? r.httpStatus}: ${String(e.message || 'unknown').slice(0, 160)}`;
    console.warn('[whatsapp] cloud rejected:', detail);
    return { ok: false, outcome: 'rejected', detail };
  }
  return { ok: true, outcome: 'sent', detail: r.data?.messages?.[0]?.id };
}
