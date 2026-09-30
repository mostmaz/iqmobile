// Outbound WhatsApp on a Meta UTILITY template, from iQ Mobile's own number.
//
// Separate from otp.js on purpose. That file is a verification flow with its
// own pending table, rate ledger and error vocabulary; this is one function
// that posts a template and reports whether it went. Sharing the transport
// would tangle two lifecycles that have nothing in common.
//
// ── Transport ───────────────────────────────────────────────────────────
//
// Meta's WhatsApp Cloud API, sending as 07502062804 (+964 750 206 2804).
// Not a bot library driving WhatsApp Web: bulk sending from an unofficial
// client is what gets a number banned, and this number is the business's.
//
// ARQAM stays behind WHATSAPP_PROVIDER=arqam as a fallback. Its OTP endpoint
// is confirmed and in daily use; its template endpoint is not documented
// publicly (their docs sit behind a dashboard login), so that path is a
// best-effort guess and is not the default.
//
// ── What has to exist before a single message can go out ────────────────
//
// 1. A Meta Business account with a WhatsApp Business Account (WABA), and
//    +9647502062804 registered ON it. THE NUMBER CANNOT BE IN BOTH PLACES:
//    moving it to the Cloud API removes it from the WhatsApp / WhatsApp
//    Business app on the phone, and its chat history goes with it. If that
//    number is answered by hand today, register a second number instead.
//
// 2. A permanent access token (Meta Business Settings → System users → a
//    system user with the whatsapp_business_messaging permission on the
//    WABA). The temporary token in the developer console expires in 24h and
//    will strand the sweep silently.
//
// 3. The template, approved by Meta as UTILITY (a marketing template to a
//    number that never opted in is what gets an account restricted):
//
//      name:     unanswered_chat
//      category: UTILITY
//      language: ar
//      body:     مرحباً {{1}}، عندك رسالة على iQ Mobile بخصوص {{2}} من ٢٤ ساعة
//                وما انفتحت بعد. افتح التطبيق للرد.
//
//    Not «رسالة من مشتري»: the sweep follows the unread message whichever
//    side it is on, so the same template also reaches a buyer waiting on a
//    seller's answer. Naming the wrong role would read as a mistake.
//
//    {{1}} = the recipient's name, {{2}} = the device. Change the ORDER or
//    COUNT here and in chatNudge.js together — Meta rejects a mismatch by
//    delivering nothing.
//
// 4. WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TOKEN in the server env, then
//    chat_nudge_dry_run=0 in the dashboard.
//
// Every one of those is a place the send can fail silently, which is why the
// sweep records an outcome per attempt and why the dry run is the default.
import { toE164 } from './iraqiPhone.js';

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'cloud').toLowerCase();

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
  return PROVIDER === 'arqam'
    ? !!ARQAM_KEY && !!ARQAM_TEMPLATE
    : !!PHONE_NUMBER_ID && !!TOKEN;
}

/** Which transport is live, for the dashboard to show rather than guess. */
export function utilityProvider() {
  return { provider: PROVIDER, configured: utilityConfigured(), template: PROVIDER === 'arqam' ? ARQAM_TEMPLATE : TEMPLATE };
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
export async function sendUtilityTemplate(phone, params, { dryRun = true } = {}) {
  if (!utilityConfigured()) return { ok: false, outcome: 'unconfigured' };

  const to = toE164(phone);
  if (!to) return { ok: false, outcome: 'bad_phone' };

  if (dryRun) {
    // The point of the dry run: prove the selection is right, against real
    // production rows, before one message reaches a real person.
    console.log(`[whatsapp][dry-run] ${PROVIDER}:${TEMPLATE} → ${to} params=${JSON.stringify(params)}`);
    return { ok: true, outcome: 'dry_run' };
  }

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
