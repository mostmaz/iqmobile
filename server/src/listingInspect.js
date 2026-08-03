// AI listing inspection — reads a new listing's description AND its photos to
// spot phones that are broken, cracked, or repaired.
//
// This complements listingQuality.js rather than replacing it. That module
// matches literal words (مكسور، عاطل، لا يعمل) at submit time and is free,
// instant, and deterministic — it stays the first gate. This one runs after
// the photos are uploaded and adds the two things a wordlist can't do:
//   1. meaning, not spelling — "الشاشة بيها خط", "وقع منه", "يحتاج تصليح"
//   2. the photos themselves — a cracked screen the seller never mentioned
//
// Deliberately conservative by default. A listing is never auto-rejected
// unless BOTH switches are on and the model is highly confident; otherwise a
// flagged listing stays live and lands in the dashboard review queue. A false
// positive that silently kills a legitimate seller's ad is far worse than a
// missed defect that a human catches a few minutes later.
//
// Off unless: ANTHROPIC_API_KEY is set AND listing_inspection_enabled=1.
// Nothing here ever throws into a request path — every entry point is wrapped.

import Anthropic from '@anthropic-ai/sdk';
import { db, now, getSetting } from './db.js';

// The public origin Claude fetches images from. Same default as the social
// publisher — override with PUBLIC_BASE_URL if the API ever moves.
const publicBase = () =>
  (process.env.PUBLIC_BASE_URL || 'https://api.iqmobile.org').replace(/\/+$/, '');

// Images dominate the token cost (a photo is worth far more tokens than the
// description), so cap how many we send. 3 is enough to see the screen, the
// back, and one angle; more adds cost without catching much extra.
const MAX_IMAGES_INSPECTED = 3;

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
// Second, independent switch. With this off (the default) inspection only
// ever flags for review — it will not remove a listing on its own.
export function autoRejectEnabled() {
  return getSetting('listing_inspection_autoreject') === '1';
}

// Schema the model's answer is constrained to. With output_config.format the
// response is guaranteed to parse — no prose to scrape, no defensive regex.
const SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['clean', 'suspect', 'defective'],
      description: 'clean = nothing wrong; suspect = possible issue, needs a human; defective = clearly broken/damaged',
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
              'screen_defect', 'water_damage', 'missing_part',
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
const SYSTEM = `أنت مُدقّق إعلانات في سوق موبايلات عراقي. مهمتك: هل هذا الجهاز مكسور أو معطّل أو مُصلَّح؟

افحص أمرين معاً:
1) نص الإعلان — ابحث عن المعنى لا الكلمة: "الشاشة بيها خط"، "وقع منه"، "يحتاج تصليح"، "البطارية ما تدوم"، "مفتوح سابقاً".
2) الصور — شقوق بالشاشة أو الظهر، انبعاج، خدوش عميقة، بقع أو خطوط بالشاشة، أثر ماء.

لا تُعلّم الإعلان إذا كان:
- واقي شاشة فيه فقاعات أو خدش (الواقي ليس الجهاز)
- انعكاس ضوء، بصمات، غبار، أو صورة غير واضحة
- كفر/جراب، أو علامات استعمال عادية على جهاز معلن كـ"مستعمل"
- شاشة مطفأة أو سوداء بدون كسر ظاهر

قواعد الحكم:
- defective: عيب واضح ومؤكد تراه أو تقرأه صراحة.
- suspect: مؤشر محتمل لكن الصورة غير حاسمة أو النص غامض.
- clean: لا شيء.
إذا شككت، اختر suspect وليس defective — القرار النهائي لموظف بشري.
اكتب evidence بجملة عربية قصيرة تصلح لعرضها على البائع.`;

// Inspect one listing. Returns the parsed result, or null if disabled/failed.
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
    model: 'claude-opus-5',
    max_tokens: 1024,
    // The system prompt is byte-identical every call, so caching it means we
    // only pay full price for it once per 5-minute window.
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // effort low keeps this cheap; it's a bounded classification, not research.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: parts }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

// Fire-and-forget entry point for the request path. Never throws, never
// blocks — callers wrap it in setImmediate so the seller's upload has already
// returned by the time this runs.
export function inspectListingAsync(listingId) {
  if (!inspectionEnabled()) return;
  (async () => {
    try {
      const listing = db.prepare('SELECT * FROM phone_listings WHERE id=?').get(listingId);
      if (!listing || listing.status !== 'active') return;
      const images = db
        .prepare('SELECT image_path FROM listing_images WHERE listing_id=? ORDER BY position ASC, id ASC')
        .all(listingId)
        .map((r) => r.image_path);
      if (images.length === 0) return; // nothing to look at yet

      const result = await inspectListing(listing, images);
      if (!result) return;

      db.prepare(
        `INSERT INTO listing_inspections(listing_id, verdict, confidence, defects_json, status, created_at)
         VALUES(?,?,?,?,'pending',?)
         ON CONFLICT(listing_id) DO UPDATE SET
           verdict=excluded.verdict, confidence=excluded.confidence,
           defects_json=excluded.defects_json, status='pending',
           reviewed_at=NULL, error=NULL, created_at=excluded.created_at`,
      ).run(listingId, result.verdict, result.confidence, JSON.stringify(result.defects || []), now());

      // Only a confirmed defect at high confidence can remove a listing, and
      // only when the operator has explicitly opted in to that.
      if (autoRejectEnabled() && result.verdict === 'defective' && result.confidence === 'high') {
        db.prepare("UPDATE phone_listings SET status='removed', updated_at=? WHERE id=?").run(now(), listingId);
        db.prepare("UPDATE listing_inspections SET status='removed', reviewed_at=? WHERE listing_id=?")
          .run(now(), listingId);
        console.warn(`[inspect] auto-removed listing=${listingId} :: ${JSON.stringify(result.defects)}`);
      } else {
        console.log(`[inspect] listing=${listingId} verdict=${result.verdict} confidence=${result.confidence}`);
      }
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
  })();
}
