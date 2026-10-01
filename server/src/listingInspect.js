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
// What happens to a verdict (see applyInspectionResult):
//   clean      → GOOD. Listing stays published; verdict logged for audit.
//   suspect    → unclear. Listing stays published, lands in the review queue.
//   defective  → BAD. With listing_inspection_hold on (default) the listing
//                is pulled from publishing (status='removed' + review_hold=1,
//                the same trick drafts use), the seller is told the crew will
//                review it, and an operator approves or rejects it from the
//                dashboard. With the hold switch off, it behaves like suspect.
//   A low-confidence "defective" is treated as suspect: the prompt tells the
//   model to answer suspect when unsure, so a hesitant bad verdict is not a
//   strong enough reason to hide someone's ad.
//
// Off unless: ANTHROPIC_API_KEY is set AND listing_inspection_enabled=1.
// Nothing here ever throws into a request path — every entry point is wrapped.

import Anthropic from '@anthropic-ai/sdk';
import { db, now, getSetting } from './db.js';
import { notifyListingReview } from './notify.js';
import { pushToAdmins } from './adminPush.js';

// The public origin Claude fetches images from. Same default as the social
// publisher — override with PUBLIC_BASE_URL if the API ever moves.
const publicBase = () =>
  (process.env.PUBLIC_BASE_URL || 'https://api.iqmobile.org').replace(/\/+$/, '');

// Images dominate the token cost (a photo is worth far more tokens than the
// description), so cap how many we send. 3 is enough to see the screen, the
// back, and one angle; more adds cost without catching much extra.
const MAX_IMAGES_INSPECTED = 3;

// Which Claude model does the judging. Overridable so the operator can trade
// accuracy for cost without a deploy (see docs/listing-quality-ai-review.md
// for the per-1000-listings comparison).
const MODEL = () => process.env.LISTING_INSPECT_MODEL || 'claude-opus-5-5';

// The app uploads photos ONE AT A TIME, each hitting POST /listings/:id/images.
// Inspecting on every upload meant three or four concurrent checks of the
// same listing, each seeing a different subset of the photos and each paying
// full price. Wait for the uploads to go quiet, then look once at all of them.
const INSPECT_DEBOUNCE_MS = Number(process.env.LISTING_INSPECT_DEBOUNCE_MS) || 20_000;

let _client = null;
function client() {
  if (!_client) _client = new Anthropic();
  return _client;
}

export function inspectionConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}
export function inspectionEnabled() {
  return inspectionConfigured() && getSetting('listing_inspection_enabled') === '1';
}
// Second, independent switch. With this off (the default) inspection never
// removes a listing on its own — a held listing still waits for a human.
export function autoRejectEnabled() {
  return getSetting('listing_inspection_autoreject') === '1';
}
// Hold a BAD listing back from publishing until an operator decides. Default
// on; off means a bad verdict only queues the listing while it stays live.
export function holdEnabled() {
  return getSetting('listing_inspection_hold') !== '0';
}

// Schema the model's answer is constrained to. With output_config.format the
// response is guaranteed to parse — no prose to scrape, no defensive regex.
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

// Ask the model about one listing. Returns the parsed result, or null if the
// model declined to answer.
export async function inspectListing(listing, imagePaths) {
  const urls = (imagePaths || []).slice(0, MAX_IMAGES_INSPECTED).map((p) => `${publicBase()}${p}`);
  const parts = urls.map((url) => ({ type: 'image', source: { type: 'url', url } }));
  parts.push({
    type: 'text',
    text: [
      `الجهاز: ${listing.brand} ${listing.model}`,
      `الحالة المعلنة: ${listing.condition}`,
      `السعر: ${listing.asking_price}`,
      `الوصف: ${listing.description || '(بدون وصف)'}`,
    ].join('\n'),
  });

  const response = await client().messages.create({
    model: MODEL(),
    max_tokens: 1024,
    // The system prompt is byte-identical every call, so caching it means we
    // only pay full price for it once per 5-minute window.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // effort low keeps this cheap; it's a bounded classification, not research.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: parts }],
  });

  // A safety-classifier decline comes back as a normal 200 with no answer.
  // Recorded as an error row so it shows in the dashboard, never as "clean".
  if (response.stop_reason === 'refusal') {
    throw new Error(`model refused (${response.stop_details?.category || 'unspecified'})`);
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

// ─── applying a verdict ────────────────────────────────────────────────

/** The headline reason, as one Arabic sentence the seller can read. */
function headline(result) {
  const d = (result.defects || []).find((x) => x && x.evidence);
  return d ? String(d.evidence).slice(0, 200) : null;
}

/**
 * Record `result` for `listingId` and act on it: hold, remove, or leave it
 * live. Split from the model call so the decision is testable without a key.
 * Returns what was done: 'clean' | 'queued' | 'held' | 'removed' | 'skipped'.
 */
export function applyInspectionResult(listingId, result) {
  const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listingId);
  if (!listing) return 'skipped';

  db.prepare(
    `INSERT INTO listing_inspections(listing_id, verdict, confidence, defects_json, status, created_at)
     VALUES(?,?,?,?,'pending',?)
     ON CONFLICT(listing_id) DO UPDATE SET
       verdict=excluded.verdict, confidence=excluded.confidence,
       defects_json=excluded.defects_json, status='pending',
       reviewed_at=NULL, error=NULL, created_at=excluded.created_at`,
  ).run(listingId, result.verdict, result.confidence, JSON.stringify(result.defects || []), now());

  const bad = result.verdict === 'defective' && result.confidence !== 'low';
  const t = now();

  // Only a confirmed defect at high confidence can remove a listing outright,
  // and only when the operator has explicitly opted in to that.
  if (autoRejectEnabled() && result.verdict === 'defective' && result.confidence === 'high') {
    db.prepare("UPDATE phone_listings SET status='removed', review_hold=0, updated_at=? WHERE id=?")
      .run(t, listingId);
    db.prepare("UPDATE listing_inspections SET status='removed', reviewed_at=? WHERE listing_id=?")
      .run(t, listingId);
    notifyListingReview(listing.seller_id, 'rejected', listing, headline(result));
    console.warn(`[inspect] auto-removed listing=${listingId} :: ${JSON.stringify(result.defects)}`);
    return 'removed';
  }

  if (bad && holdEnabled()) {
    // Already held (re-inspection after the seller changed photos): keep it
    // held, refresh the verdict for the operator, don't notify twice.
    if (!listing.review_hold) {
      db.prepare("UPDATE phone_listings SET status='removed', review_hold=1, updated_at=? WHERE id=?")
        .run(t, listingId);
      notifyListingReview(listing.seller_id, 'pending', listing, headline(result));
      pushToAdmins(
        'listing.review',
        'إعلان محجوب بانتظار المراجعة',
        `${listing.brand} ${listing.model} — ${headline(result) || 'عيب مرصود'}`,
        { listing_id: listingId },
      ).catch(() => {});
    }
    console.log(`[inspect] held listing=${listingId} confidence=${result.confidence}`);
    return 'held';
  }

  // A listing that was held and now reads clean (photos changed) stays held —
  // an operator still has to release it, otherwise deleting the one bad
  // photo would be a self-service bypass. The queue keeps it visible because
  // it lists every held listing regardless of verdict.
  console.log(`[inspect] listing=${listingId} verdict=${result.verdict} confidence=${result.confidence}`);
  return result.verdict === 'clean' ? 'clean' : 'queued';
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
  const wasHeld = !!listing?.review_hold;
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
