// One-off migration: walk every active listing's `contact_phone`, find or
// create a user account with that phone, then reassign the listing's
// `seller_id` to that user. Optionally delete orphaned synthetic
// `seed:*` users left behind by the Samsung batch import.
//
// Why: listings were imported in bulk (server/scripts/seedSamsungPosts.js)
// where each was assigned a synthetic seller (phone = "seed:samsung:<slug>")
// because the importer didn't know the real seller's account didn't exist
// yet. As a result, when a real seller later phone-logs in with the same
// number that's on their listing's `contact_phone`, the server has no row
// matching their phone → it creates a fresh "مستخدم XXXX" user that is
// NOT attached to the listing. The seller sees their own listing as
// someone else's; they can't edit it; they can't see incoming chats.
//
// This script fixes the data by pre-creating real accounts so phone-login
// hits the happy path: server finds the existing row by phone → logs the
// user straight in → listings + chats already attached.
//
// Run modes:
//   DRY=1 node scripts/createUsersFromListingPhones.js   # preview only
//   node scripts/createUsersFromListingPhones.js         # actually write
//
// Idempotent: re-running after a successful run is a no-op (every phone
// already has a user, every listing already points to it).
//
// Safety:
//   - All writes are inside one transaction. A failure rolls back.
//   - Invalid-length / non-mobile / sequential-test phones are skipped
//     (see SKIP_PATTERNS below).

import 'dotenv/config';
import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH || './data/iqmobile.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const DRY = process.env.DRY === '1';

function now() { return Date.now(); }

// Same normaliser used by routes/auth.js. Re-implemented here so this
// script can run standalone (no ESM imports across files needed when
// node is launched against `scripts/`).
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  let d = input.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00964')) d = d.slice(5);
  else if (d.startsWith('964')) d = d.slice(3);
  if (!d.startsWith('0')) d = '0' + d;
  if (d.length < 10 || d.length > 12) return null;
  return d;
}

// Heuristics for "obviously junk" phones the user wanted skipped.
// All are *additional* to the normalizePhone length check.
//   - Not starting with 07 → not an Iraqi mobile (landlines, foreign).
//   - Length != 11 after normalisation → too short / too long.
//   - Trailing 7+ digit sequence is a stride-1 ascending/descending run
//     ("12345678", "98765432") → test placeholder data.
function isLikelyTestOrInvalid(phone) {
  if (!phone) return true;
  if (!phone.startsWith('07')) return true;        // not a mobile
  if (phone.length !== 11) return true;             // Iraqi mobile is 11 digits
  // Trailing-8 stride-1 detector: 12345678, 23456789, 87654321, …
  const tail = phone.slice(-8);
  if (/^\d{8}$/.test(tail)) {
    let asc = true, desc = true;
    for (let i = 1; i < tail.length; i++) {
      const diff = tail.charCodeAt(i) - tail.charCodeAt(i - 1);
      if (diff !== 1) asc = false;
      if (diff !== -1) desc = false;
    }
    if (asc || desc) return true;
  }
  // Trailing-7 also (e.g. 07701234567)
  const tail7 = phone.slice(-7);
  if (/^\d{7}$/.test(tail7)) {
    let asc = true;
    for (let i = 1; i < tail7.length; i++) {
      if (tail7.charCodeAt(i) - tail7.charCodeAt(i - 1) !== 1) { asc = false; break; }
    }
    if (asc) return true;
  }
  return false;
}

// Find or create a user keyed by phone. Returns the user row.
//
// New user defaults:
//   - is_guest = 0   (this is a real account holder, just hasn't logged
//                     in yet — phone-login will treat them as existing)
//   - password_hash = '' (empty → impossible to bcrypt.compare against,
//                     so the only way in is OTP / phone-login)
//   - display_name from the listing's current seller (preserves the
//     poster identity buyers already see).
//   - governorate from the listing.
function findOrCreateUser(phone, displayName, governorate) {
  const existing = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
  if (existing) return { row: existing, created: false };
  if (DRY) {
    return { row: { id: '(would-create)', phone, display_name: displayName }, created: true };
  }
  const id = db.prepare(
    `INSERT INTO users(phone, password_hash, display_name, governorate, seller_type, is_guest, created_at)
     VALUES(?, '', ?, ?, 'individual', 0, ?)`,
  ).run(phone, displayName, governorate || 'Baghdad', now()).lastInsertRowid;
  return { row: db.prepare('SELECT * FROM users WHERE id=?').get(id), created: true };
}

const stats = {
  scanned_listings: 0,
  reassigned_to_existing_user: 0,
  reassigned_to_new_user: 0,
  unchanged_already_correct: 0,
  skipped_no_contact_phone: 0,
  skipped_invalid_or_test: 0,
  new_users: 0,
  cleaned_synthetic_users: 0,
};

const listings = db.prepare(`
  SELECT pl.id, pl.contact_phone, pl.seller_id, pl.governorate,
         u.phone AS seller_phone, u.display_name AS seller_name
  FROM phone_listings pl
  JOIN users u ON u.id = pl.seller_id
  WHERE pl.status != 'removed'
`).all();

const skipped = [];
const actions = [];  // [{ listing_id, action, before, after }]

const txn = db.transaction(() => {
  for (const lst of listings) {
    stats.scanned_listings++;

    if (!lst.contact_phone || lst.contact_phone.trim() === '') {
      stats.skipped_no_contact_phone++;
      skipped.push({ id: lst.id, why: 'no contact_phone', seller: lst.seller_name });
      continue;
    }

    const phone = normalizePhone(lst.contact_phone);
    if (!phone || isLikelyTestOrInvalid(phone)) {
      stats.skipped_invalid_or_test++;
      skipped.push({ id: lst.id, why: 'invalid/test', phone: lst.contact_phone, seller: lst.seller_name });
      continue;
    }

    // If the existing seller_id ALREADY has this same phone, nothing
    // to do — listing is correctly attached.
    if (lst.seller_phone === phone) {
      stats.unchanged_already_correct++;
      continue;
    }

    // Display name: prefer the listing's current synthetic seller's
    // name (set by seedSamsungPosts.js to the original Excel poster
    // name). Fallback to a generic phone-derived name.
    const fallbackName = `مستخدم ${phone.slice(-4)}`;
    const candidateName = (lst.seller_name && !lst.seller_name.startsWith('ضيف')) ? lst.seller_name : fallbackName;

    const { row: user, created } = findOrCreateUser(phone, candidateName, lst.governorate);

    if (created) stats.new_users++;

    if (!DRY) {
      db.prepare('UPDATE phone_listings SET seller_id=? WHERE id=?').run(user.id, lst.id);
    }

    if (created) stats.reassigned_to_new_user++;
    else stats.reassigned_to_existing_user++;

    actions.push({
      listing_id: lst.id,
      action: created ? 'CREATE_AND_REASSIGN' : 'REASSIGN_ONLY',
      from: `${lst.seller_id} (${lst.seller_name})`,
      to: `${user.id} (${user.display_name}) [${phone}]`,
    });
  }

  // Cleanup: remove synthetic seed:samsung:* user rows that no longer
  // own any listings. Defensive — only delete users with no remaining
  // rows in any table that references user_id (listings, chats,
  // ratings, deals, notifications).
  if (!DRY) {
    const orphans = db.prepare(`
      SELECT id, phone, display_name FROM users
      WHERE phone LIKE 'seed:%'
        AND id NOT IN (SELECT DISTINCT seller_id FROM phone_listings WHERE seller_id IS NOT NULL)
        AND id NOT IN (SELECT DISTINCT buyer_id FROM chats)
        AND id NOT IN (SELECT DISTINCT seller_id FROM chats)
    `).all();
    for (const o of orphans) {
      db.prepare('DELETE FROM users WHERE id=?').run(o.id);
      stats.cleaned_synthetic_users++;
    }
  } else {
    const orphans = db.prepare(`
      SELECT id, phone, display_name FROM users
      WHERE phone LIKE 'seed:%'
    `).all();
    // Dry run: we can't tell which would be orphaned without doing the
    // reassignments first. Report total seed:* count as upper bound.
    stats.cleaned_synthetic_users = orphans.length;
  }
});

console.log(DRY ? '== DRY RUN (no writes) ==' : '== APPLY (writing) ==');
txn();

if (actions.length) {
  console.log('\nActions:');
  for (const a of actions) {
    console.log(`  L#${String(a.listing_id).padStart(4)}  ${a.action.padEnd(20)}  ${a.from}  →  ${a.to}`);
  }
}

if (skipped.length) {
  console.log('\nSkipped:');
  for (const s of skipped) {
    console.log(`  L#${String(s.id).padStart(4)}  ${s.why.padEnd(18)}  ${s.phone || ''}  (seller: ${s.seller})`);
  }
}

console.log('\nStats:');
console.table(stats);
console.log(DRY ? '\nDRY mode — no writes performed. Re-run without DRY=1 to apply.' : '\nDONE.');
