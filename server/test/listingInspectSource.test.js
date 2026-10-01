// Every row in listing_inspections says who judged it. The keyword gate
// that used to write 'words' rows is retired; only the model writes now,
// and the old rows keep their label so the queue still tells them apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-judged-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';

const { db } = await import('../src/db.js');
const { applyInspectionResult } = await import('../src/listingInspect.js');

const NOW = Date.now();
db.prepare(`INSERT INTO users(id, phone, password_hash, display_name, governorate, seller_type, created_at)
            VALUES(1,'07700000001','x','بائع','Baghdad','individual',?)`).run(NOW);
function listing(id) {
  db.prepare(`INSERT INTO phone_listings(id, seller_id, brand, model, condition, asking_price,
      governorate, status, is_draft, created_at, updated_at, expires_at)
    VALUES(?,1,'Apple','iPhone 13','used',500000,'Baghdad','active',0,?,?,?)`).run(id, NOW, NOW, NOW + 86400000);
  return id;
}
const row = (id) => db.prepare('SELECT verdict, judged_by, status FROM listing_inspections WHERE listing_id=?').get(id);
function oldWordsRow(id) {
  db.prepare(`INSERT INTO listing_inspections(listing_id, verdict, confidence, defects_json, status, created_at, judged_by)
              VALUES(?,'suspect','medium',?,'pending',?,'words')`)
    .run(id, JSON.stringify([{ kind: 'cracked_screen', source: 'description', evidence: 'الوصف يذكر: «كسر»' }]), NOW);
}

test('a model verdict signs as model, and replaces a leftover gate row on the same listing', () => {
  const id = listing(2);
  oldWordsRow(id);
  applyInspectionResult(id, { verdict: 'clean', confidence: 'high', defects: [] });
  assert.deepEqual(row(id), { verdict: 'clean', judged_by: 'model', status: 'pending' });
});

test('old rows are told apart by the gate wording', () => {
  // Rows written before the column existed: the gate always wrote this
  // exact evidence; the model never does.
  db.prepare(`INSERT INTO listing_inspections(listing_id, verdict, confidence, defects_json, status, created_at)
              VALUES(?,'suspect','medium',?,'pending',?)`)
    .run(listing(3), JSON.stringify([{ kind: 'cracked_screen', source: 'description', evidence: 'الوصف يذكر: «كسر»' }]), NOW);
  db.prepare(`INSERT INTO listing_inspections(listing_id, verdict, confidence, defects_json, status, created_at)
              VALUES(?,'defective','high',?,'pending',?)`)
    .run(listing(4), JSON.stringify([{ kind: 'cracked_back', source: 'image', evidence: 'الظهر مكسور بوضوح' }]), NOW);
  db.prepare("UPDATE listing_inspections SET judged_by='words' WHERE judged_by IS NULL AND error IS NULL AND defects_json LIKE '%الوصف يذكر: «%'").run();
  db.prepare("UPDATE listing_inspections SET judged_by='model' WHERE judged_by IS NULL").run();
  assert.equal(row(3).judged_by, 'words');
  assert.equal(row(4).judged_by, 'model');
});
