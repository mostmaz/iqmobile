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
 * What the bot actually types.
 *
 * Four openings, picked from the recipient's own id rather than at random,
 * so one person always gets the same wording (a different greeting on a
 * resend would read as a second, careless message) while the outbound stream
 * is not the identical string a thousand times — which is exactly the
 * pattern an automated sender is spotted by.
 */
export function botText({ name, device, waiting = 1, userId = 0 }) {
  const openings = ['مرحباً', 'السلام عليكم', 'هلا', 'مساء الخير'];
  const hi = openings[Math.abs(Number(userId) || 0) % openings.length];
  const who = name ? `${hi} ${name}` : hi;
  const more = waiting > 1
    ? ` وعندك ${waiting} محادثات تنتظر ردك.`
    : '';
  return `${who} 👋\nعندك رسالة على iQ Mobile بخصوص ${device || 'جهازك'} من ٢٤ ساعة وما انفتحت بعد.${more}\nافتح التطبيق للرد قبل ما يشتري من غيرك.`;
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

async function post(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { httpStatus: res.status, ok: res.ok, data };
  } catch (e) {
    // Never surface the exception text — it can carry the URL and the token.
    return { httpStatus: 0, ok: false, data: null, transport: e?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one templated message.
 *
 * Returns { ok, outcome, detail } and NEVER throws — a nudge must not be able
 * to break the sweep that sends it, let alone the request that scheduled it.
 *
 * outcome: sent | dry_run | unconfigured | bad_phone | rejected | transport
 */
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
