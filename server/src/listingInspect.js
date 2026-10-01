// AI listing quality check — reads a new listing's description AND its photos
// and sorts the device into GOOD (publish) or BAD (hold for a human).
//
// This complements listingQuality.js rather than replacing it. That module
// matches literal words (مكسور، عاطل، لا يعمل) at submit time and is free,
// instant, and deterministic — it stays the first gate. This one runs after
// the photos are uploaded and adds the two things a wordlist can't do:
//   1. meaning, not spelling — "الشاشة بيها خط", "وقع منه", "يحتاج تصليح"
//   2. the photos themselves — a cracked screen the seller never mentioned
//
// Two modes, one switch (listing_inspection_decide; see applyInspectionResult):
//
//   CHECK ONLY (default) — every verdict is recorded and shown in the
//   dashboard's الفحص tab; every listing stays live. suspect/defective rows
//   sit in the review list so an operator CAN act, but nothing is forced.
//
//   DECIDE — the verdict has consequences:
//     clean, medium/high confidence → published (stays live)
//     defective, high confidence    → NOT published: status='removed', the
//                                     seller is told, an operator can
//                                     overturn it from the tab
//     anything else (suspect, a hesitant defective, any low-confidence
//     answer)                       → HELD for review: unpublished
//                                     (status='removed' + review_hold=1, the
//                                     same trick drafts use), seller told the
//                                     crew will look, operator decides
//
// Off unless: the chosen model's API key is set AND listing_inspection_enabled=1.
// Nothing here ever throws into a request path — every entry point is wrapped.

import path from 'node:path';
import sharp from 'sharp';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { db, now, getSetting } from './db.js';
import { notifyListingReview } from './notify.js';
import { pushToAdmins } from './adminPush.js';

// The public origin the model fetches images from. Same default as the social
// publisher — override with PUBLIC_BASE_URL if the API ever moves.
const publicBase = () =>
  (process.env.PUBLIC_BASE_URL || 'https://api.iqmobile.org').replace(/\/+$/, '');

// Images dominate the token cost (a photo is worth far more tokens than the
// description), so cap how many we send. 3 is enough to see the screen, the
// back, and one angle; more adds cost without catching much extra.
const MAX_IMAGES_INSPECTED = 3;

// …and cap how big each one is. Photos are resized here, before the call,
// to fit 1280×720 — long edge 1280, short edge 720, whichever way the phone
// was held — with the aspect ratio kept. Fitting rather than cropping, so a
// crack at the edge of the frame is never the part that gets cut off. At
// 32-px patches that is at most ≈1,100 tokens a photo instead of ≈1,440 for
// the 1280-long-edge upload. Override: LISTING_INSPECT_IMAGE_MAX=1280x720.
const IMAGE_MAX = (() => {
  const m = /^(\d{2,4})x(\d{2,4})$/i.exec(process.env.LISTING_INSPECT_IMAGE_MAX || '');
  const long = m ? Number(m[1]) : 1280;
  const short = m ? Number(m[2]) : 720;
  return { long: Math.max(long, short), short: Math.min(long, short) };
})();
const IMAGE_JPEG_QUALITY = 80;
// Where POST /listings/:id/images writes files (routes/listings.js UP);
// image_path is '/uploads/<name>'.
const UPLOADS_DIR = path.resolve('./uploads');

/**
 * The photo as the model should see it: rotated per EXIF, shrunk to fit
 * IMAGE_MAX (orientation-aware), JPEG. Returns { data, media_type } with
 * base64 data, or null if the file is unreadable — the caller then falls
 * back to the public URL so a missing file never blocks the check.
 */
export async function prepareImage(imagePath, max = IMAGE_MAX) {
  try {
    const file = path.join(UPLOADS_DIR, path.basename(imagePath));
    // rotate() first applies the EXIF orientation, so a phone photo taken
    // upright is upright for the model and for the width/height below.
    const img = sharp(file).rotate();
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    // EXIF orientations 5–8 swap the axes once rotate() has run.
    const swapped = (meta.orientation || 1) >= 5;
    const portrait = (swapped ? w > h : h > w);
    const box = portrait ? { width: max.short, height: max.long } : { width: max.long, height: max.short };
    const data = await img
      .resize({ ...box, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: IMAGE_JPEG_QUALITY })
      .toBuffer();
    return { data: data.toString('base64'), media_type: 'image/jpeg' };
  } catch {
    return null;
  }
}

// Which model does the judging. The name picks the vendor: gpt-* goes to
// OpenAI, claude-* to Anthropic. Chosen in the dashboard (Settings →
// listing_inspection_model), falling back to LISTING_INSPECT_MODEL in .env,
// then to GPT-6 Luna, the cheapest vision model in the comparison in
// docs/listing-quality-ai-review.md (≈ $0.6 per 1,000 listings). The API
// keys stay in .env: a secret has no business in a settings table.
export const DEFAULT_MODEL = 'gpt-6-luna';
export const MODEL = () =>
  getSetting('listing_inspection_model') || process.env.LISTING_INSPECT_MODEL || DEFAULT_MODEL;
export function providerFor(model = MODEL()) {
  return /^claude-/i.test(model) ? 'anthropic' : 'openai';
}
/** A model id the dashboard may store: a vendor prefix we route, sane chars. */
export function isValidModelId(id) {
  return typeof id === 'string' && /^(gpt|claude)-[a-z0-9.\-]{1,60}$/i.test(id);
}

// What the dashboard offers. `per_1000` is the ≈ USD estimate from the doc
// (3 photos + description per listing); anything not listed can still be
// typed in, as long as isValidModelId accepts it.
export const MODEL_CATALOG = [
  { id: 'gpt-6-luna', vendor: 'openai', label: 'OpenAI GPT-6 Luna', per_1000: 0.6, note: 'الأرخص — الافتراضي' },
  { id: 'gpt-5.6-luna', vendor: 'openai', label: 'OpenAI GPT-5.6 Luna', per_1000: 1.2 },
  { id: 'gpt-5-mini', vendor: 'openai', label: 'OpenAI GPT-5 mini', per_1000: 1.5 },
  { id: 'claude-haiku-4-5', vendor: 'anthropic', label: 'Claude Haiku 4.5', per_1000: 5.6 },
  { id: 'claude-sonnet-5-5', vendor: 'anthropic', label: 'Claude Sonnet 5.5', per_1000: 11, note: 'رؤية قوية' },
  { id: 'claude-opus-5-5', vendor: 'anthropic', label: 'Claude Opus 5.5', per_1000: 22, note: 'الأدق — أقل حجب خاطئ' },
];
/** Which env var the chosen model needs — shown in the dashboard when missing. */
export function keyEnvFor(model = MODEL()) {
  return providerFor(model) === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
}

// The app uploads photos ONE AT A TIME, each hitting POST /listings/:id/images.
// Inspecting on every upload meant three or four concurrent checks of the
// same listing, each seeing a different subset of the photos and each paying
// full price. Wait for the uploads to go quiet, then look once at all of them.
const INSPECT_DEBOUNCE_MS = Number(process.env.LISTING_INSPECT_DEBOUNCE_MS) || 20_000;

let _anthropic = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}
let _openai = null;
function openai() {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

export function inspectionConfigured() {
  return !!process.env[keyEnvFor()];
}
export function inspectionEnabled() {
  return inspectionConfigured() && getSetting('listing_inspection_enabled') === '1';
}
// Second, independent switch: let the verdict decide (publish / reject /
// hold). Off (the default) means check-only — record and show, touch nothing.
export function decideEnabled() {
  return getSetting('listing_inspection_decide') === '1';
}

// Schema the model's answer is constrained to. Both vendors' structured
// output modes guarantee the response parses — no prose to scrape, no
// defensive regex. OpenAI's strict mode additionally requires every object
// to list all its properties as required and forbid extras; this does.
const SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['clean', 'suspect', 'defective'],
      description: 'clean = GOOD, publish; suspect = unclear, a human should look; defective = BAD, do not publish until a human decides',
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: [
              'cracked_screen', 'cracked_back', 'dent_or_bend', 'deep_scratches',
              'screen_defect', 'touch_fault', 'water_damage', 'missing_part',
              'not_powering_on', 'battery_fault', 'locked_account', 'repaired_before',
            ],
          },
          source: { type: 'string', enum: ['description', 'image'] },
          evidence: { type: 'string', description: 'One short Arabic sentence a seller would understand.' },
        },
        required: ['kind', 'source', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'confidence', 'defects'],
  additionalProperties: false,
};

// Written for the model, not for humans. The explicit "do not flag" list is
// load-bearing: without it, normal marketplace photos (a screen protector's
// bubbles, a reflection, a case) get read as damage and the queue fills with
// noise nobody trusts.
const SYSTEM = `أنت مُدقّق جودة في سوق موبايلات عراقي. مهمتك: تصنيف الجهاز المعروض إلى "جيد" (يُنشر) أو "سيّئ" (يُحجب حتى يراجعه موظف).

افحص أمرين معاً:
1) نص الإعلان — ابحث عن المعنى لا الكلمة: "مكسور"، "عاطل"، "ما يشتغل"، "الشاشة بيها خط"، "اللمس ما يستجيب"، "وقع منه"، "يحتاج تصليح"، "البطارية ما تدوم"، "مفتوح سابقاً".
2) الصور — انظر إلى الشاشة والظهر والأطراف.

الجهاز "سيّئ" (verdict = defective) إذا تحقق أي مما يلي بوضوح:
- الشاشة مكسورة أو مشقّقة أو مشروخة.
- مشكلة باللمس (لا يستجيب، يعمل وحده، منطقة ميتة).
- بقعة أو خط أو تشوّه في الشاشة (بقعة سوداء/صفراء، خطوط، احتراق، صورة محروقة).
- الظهر مهشّم أو مكسور أو متضرر بوضوح (زجاج متشظٍ، كاميرا مكسورة، انبعاج كبير).
- الوصف يقول صراحة إن الجهاز مكسور، أو معطّل، أو لا يعمل، أو فيه عطل.

الجهاز "جيد" (verdict = clean) إذا كان:
- جديداً أو كالجديد.
- مستعملاً بخدوش خفيفة أو عادية على الإطار أو الظهر — الخدوش ليست عيباً.

لا تُعلّم الإعلان إذا كان:
- واقي شاشة فيه فقاعات أو خدش (الواقي ليس الجهاز).
- انعكاس ضوء، بصمات، غبار، أو صورة غير واضحة.
- كفر/جراب، أو علامات استعمال عادية على جهاز معلن كـ"مستعمل".
- شاشة مطفأة أو سوداء بدون كسر ظاهر.

قواعد الحكم:
- defective: عيب من قائمة "سيّئ" تراه بوضوح أو تقرأه صراحة. اختر confidence = high عندما لا يوجد تفسير آخر معقول.
- suspect: مؤشر محتمل لكن الصورة غير حاسمة أو النص غامض.
- clean: لا شيء.
إذا شككت، اختر suspect وليس defective — القرار النهائي لموظف بشري.
اكتب evidence بجملة عربية قصيرة تصلح لعرضها على البائع.`;

/** The listing as the model reads it, after the photos. */
function listingText(listing) {
  return [
    `الجهاز: ${listing.brand} ${listing.model}`,
    `الحالة المعلنة: ${listing.condition}`,
    `السعر: ${listing.asking_price}`,
    `الوصف: ${listing.description || '(بدون وصف)'}`,
  ].join('\n');
}

// Ask the model about one listing. Returns the parsed result, or null if the
// model gave no answer. A refusal throws, so it lands in the dashboard as an
// error row rather than passing as "clean".
export async function inspectListing(listing, imagePaths) {
  const paths = (imagePaths || []).slice(0, MAX_IMAGES_INSPECTED);
  // Resized bytes when the file is on this disk; the public URL otherwise.
  const images = await Promise.all(paths.map(async (p) => {
    const prepared = await prepareImage(p);
    return prepared || { url: `${publicBase()}${p}` };
  }));
  const model = MODEL();
  return providerFor(model) === 'anthropic'
    ? inspectWithAnthropic(model, listing, images)
    : inspectWithOpenAI(model, listing, images);
}

async function inspectWithOpenAI(model, listing, images) {
  const content = images.map((im) => ({
    type: 'image_url',
    image_url: { url: im.url || `data:${im.media_type};base64,${im.data}` },
  }));
  content.push({ type: 'text', text: listingText(listing) });

  const response = await openai().chat.completions.create({
    model,
    max_completion_tokens: 1024,
    // Bounded classification, not research: the lowest effort that still
    // reasons. Luna is a reasoning model, so "none" is not an option.
    reasoning_effort: 'low',
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'listing_quality', schema: SCHEMA, strict: true },
    },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content },
    ],
  });

  const choice = response.choices?.[0];
  if (!choice) return null;
  if (choice.message?.refusal) throw new Error(`model refused: ${choice.message.refusal.slice(0, 120)}`);
  if (choice.finish_reason === 'content_filter') throw new Error('model refused (content_filter)');
  if (choice.finish_reason === 'length') throw new Error('answer cut off (max_completion_tokens)');
  const text = choice.message?.content;
  return text ? JSON.parse(text) : null;
}

async function inspectWithAnthropic(model, listing, images) {
  const parts = images.map((im) => ({
    type: 'image',
    source: im.url
      ? { type: 'url', url: im.url }
      : { type: 'base64', media_type: im.media_type, data: im.data },
  }));
  parts.push({ type: 'text', text: listingText(listing) });

  const response = await anthropic().messages.create({
    model,
    max_tokens: 1024,
    // The system prompt is byte-identical every call, so caching it means we
    // only pay full price for it once per 5-minute window.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // effort low keeps this cheap; it's a bounded classification, not research.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: parts }],
  });

  // A safety-classifier decline comes back as a normal 200 with no answer.
  if (response.stop_reason === 'refusal') {
    throw new Error(`model refused (${response.stop_details?.category || 'unspecified'})`);
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

/**
 * Is the key on this server good for the chosen model? One free call to
 * the vendor's model endpoint — no photos, no tokens — so the operator can
 * press a button instead of posting a test listing and waiting.
 * Never throws: { ok, model, key_env, error? }.
 */
export async function testConnection() {
  const model = MODEL();
  const key_env = keyEnvFor(model);
  if (!process.env[key_env]) return { ok: false, model, key_env, error: `${key_env} غير موجود في .env` };
  try {
    if (providerFor(model) === 'anthropic') await anthropic().models.retrieve(model);
    else await openai().models.retrieve(model);
    return { ok: true, model, key_env };
  } catch (e) {
    const status = e?.status ? `${e.status} ` : '';
    return { ok: false, model, key_env, error: `${status}${String(e?.message || e).slice(0, 200)}` };
  }
}

// ─── applying a verdict ────────────────────────────────────────────────

/** The headline reason, as one Arabic sentence the seller can read. */
function headline(result) {
  const d = (result.defects || []).find((x) => x && x.evidence);
  return d ? String(d.evidence).slice(0, 200) : null;
}

/**
 * What the verdict means for the listing under the current switch.
 * Pure, so the rule is readable and testable in one place.
 */
export function decisionFor(result, decide = decideEnabled()) {
  if (!decide) return 'logged';
  const { verdict, confidence } = result;
  if (verdict === 'clean' && confidence !== 'low') return 'published';
  if (verdict === 'defective' && confidence === 'high') return 'rejected';
  return 'held';
}

/**
 * Record `result` for `listingId` and act on it per decisionFor(). Split
 * from the model call so the decision is testable without a key.
 * Returns the action taken: 'logged' | 'published' | 'held' | 'rejected' |
 * 'skipped'.
 */
export function applyInspectionResult(listingId, result) {
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listingId);
  if (!listing) return 'skipped';

  const action = decisionFor(result);
  const t = now();
  // Every result is kept, good ones included — the dashboard shows all of
  // them. status is the human side: 'pending' until an operator looks,
  // except a rejection, which is already decided (and can be overturned).
  db.prepare(
    `INSERT INTO listing_inspections(listing_id, verdict, confidence, defects_json, status, action, created_at)
     VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(listing_id) DO UPDATE SET
       verdict=excluded.verdict, confidence=excluded.confidence,
       defects_json=excluded.defects_json, status=excluded.status, action=excluded.action,
       reviewed_at=NULL, error=NULL, created_at=excluded.created_at`,
  ).run(
    listingId, result.verdict, result.confidence, JSON.stringify(result.defects || []),
    action === 'rejected' ? 'removed' : 'pending', action, t,
  );

  if (action === 'rejected') {
    db.prepare("UPDATE phone_listings SET status='removed', review_hold=0, updated_at=? WHERE id=?")
      .run(t, listingId);
    db.prepare('UPDATE listing_inspections SET reviewed_at=? WHERE listing_id=?').run(t, listingId);
    notifyListingReview(listing.seller_id, 'rejected', listing, headline(result));
    console.warn(`[inspect] rejected listing=${listingId} :: ${JSON.stringify(result.defects)}`);
    return action;
  }

  if (action === 'held') {
    // Already held (re-inspection after the seller changed photos): keep it
    // held, refresh the verdict for the operator, don't notify twice.
    if (!listing.review_hold) {
      db.prepare("UPDATE phone_listings SET status='removed', review_hold=1, updated_at=? WHERE id=?")
        .run(t, listingId);
      notifyListingReview(listing.seller_id, 'pending', listing, headline(result));
      pushToAdmins(
        'listing.review',
        'إعلان محجوب بانتظار المراجعة',
        `${listing.brand} ${listing.model} — ${headline(result) || 'بحاجة لنظرة'}`,
        { listing_id: listingId },
      ).catch(() => {});
    }
    console.log(`[inspect] held listing=${listingId} verdict=${result.verdict} confidence=${result.confidence}`);
    return action;
  }

  // 'published' or 'logged': the listing is left exactly as it was. A held
  // listing that now reads clean (photos changed) stays held — an operator
  // still has to release it, otherwise deleting the one bad photo would be a
  // self-service bypass. The queue lists every held listing regardless.
  console.log(`[inspect] listing=${listingId} verdict=${result.verdict} confidence=${result.confidence} action=${action}`);
  return action;
}

/**
 * Operator decision on a flagged or held listing.
 *   approve → the listing is (re)published; a held one goes live now.
 *   remove  → the listing is taken down / never published.
 * Returns the inspection row's listing_id, or null if the row doesn't exist.
 */
export function resolveInspection(inspectionId, action, { reason } = {}) {
  const row = db.prepare('SELECT * FROM listing_inspections WHERE id=?').get(inspectionId);
  if (!row) return null;
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(row.listing_id);
  const t = now();
  // Unpublished by the check — held for a human, or rejected outright (the
  // operator overturning that is exactly what 'approve' is for). A listing
  // the seller deleted since is 'deleted' on the row and stays down.
  const wasHeld = !!listing && listing.status === 'removed'
    && (!!listing.review_hold || row.action === 'rejected');
  let note = reason || null;
  if (!note) {
    try { note = headline({ defects: JSON.parse(row.defects_json || '[]') }); } catch { note = null; }
  }

  if (action === 'remove') {
    db.prepare("UPDATE phone_listings SET status='removed', review_hold=0, updated_at=? WHERE id=?")
      .run(t, row.listing_id);
    db.prepare("UPDATE listing_inspections SET status='removed', reviewed_at=? WHERE id=?").run(t, row.id);
    // A seller whose live ad was quietly taken down learns nothing; one
    // whose held ad was refused was promised an answer. Both get one.
    if (listing) notifyListingReview(listing.seller_id, 'rejected', listing, note);
    return row.listing_id;
  }

  db.prepare("UPDATE listing_inspections SET status='approved', reviewed_at=? WHERE id=?").run(t, row.id);
  if (wasHeld) {
    // Published for the first time now, so the clock starts now: the TTL it
    // was born with has been ticking while nobody could see it.
    const days = Number(getSetting('listing_ttl_days')) || 30;
    db.prepare(
      "UPDATE phone_listings SET status='active', review_hold=0, expires_at=?, updated_at=? WHERE id=?",
    ).run(t + days * 24 * 60 * 60 * 1000, t, row.listing_id);
    notifyListingReview(listing.seller_id, 'approved', listing, null);
  }
  return row.listing_id;
}

// ─── scheduling ────────────────────────────────────────────────────────

const timers = new Map();

/**
 * Inspect `listingId` once the photo uploads go quiet. Never throws, never
 * blocks — the seller's upload has long returned by the time this runs.
 * `delayMs: 0` runs at once (admin re-run).
 */
export function inspectListingAsync(listingId, { delayMs = INSPECT_DEBOUNCE_MS } = {}) {
  if (!inspectionEnabled()) return;
  const prev = timers.get(listingId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    timers.delete(listingId);
    runInspection(listingId).catch(() => {});
  }, delayMs);
  // A pending check must never keep the process alive past a shutdown.
  timer.unref?.();
  timers.set(listingId, timer);
}

async function runInspection(listingId) {
  try {
    const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listingId);
    // Live listings, and held ones (a re-run after the seller swaps photos).
    if (!listing || !(listing.status === 'active' || listing.review_hold)) return;
    const images = db
      .prepare('SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC')
      .all(listingId)
      .map((r) => r.image_path);
    if (images.length === 0) return; // nothing to look at yet

    const result = await inspectListing(listing, images);
    if (!result) return;
    applyInspectionResult(listingId, result);
  } catch (e) {
    // Record the failure so a silently-broken key or quota shows up in the
    // dashboard instead of looking like "no listings ever get flagged".
    try {
      db.prepare(
        `INSERT INTO listing_inspections(listing_id, verdict, confidence, defects_json, status, error, created_at)
         VALUES(?,'clean','low','[]','error',?,?)
         ON CONFLICT(listing_id) DO UPDATE SET status='error', error=excluded.error`,
      ).run(listingId, String(e?.message || e).slice(0, 300), now());
    } catch {}
    console.error('[inspect] failed:', e?.message);
  }
}
