// Photos go to the model resized to fit 1280×720 (long edge × short edge,
// whichever way the phone was held), aspect kept, never enlarged, and the
// bytes come back base64 for the request body. A missing file is null so
// the caller can fall back to the public URL.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-inspect-image-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-inspect-image-secret';
// prepareImage reads from ./uploads relative to the process cwd, exactly as
// the upload route writes there.
const uploads = path.resolve('./uploads');
fs.mkdirSync(uploads, { recursive: true });
const { prepareImage } = await import('../src/listingInspect.js');
const { db } = await import('../src/db.js');

const made = [];
async function photo(name, width, height) {
  const file = path.join(uploads, name);
  await sharp({ create: { width, height, channels: 3, background: '#808080' } }).jpeg().toFile(file);
  made.push(file);
  return `/uploads/${name}`;
}
async function dims(prepared) {
  const m = await sharp(Buffer.from(prepared.data, 'base64')).metadata();
  return { w: m.width, h: m.height, format: m.format };
}

after(() => {
  for (const f of made) { try { fs.unlinkSync(f); } catch {} }
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a landscape upload fits 1280×720 with its aspect kept', async () => {
  const p = await prepareImage(await photo('inspect-test-land.jpg', 4000, 3000));
  const d = await dims(p);
  assert.equal(d.format, 'jpeg');
  assert.equal(p.media_type, 'image/jpeg');
  assert.ok(d.w <= 1280 && d.h <= 720, `${d.w}×${d.h}`);
  assert.equal(d.w, 960); // 4:3 bound by the 720 height
  assert.equal(d.h, 720);
});

test('a portrait upload fits 720×1280', async () => {
  const d = await dims(await prepareImage(await photo('inspect-test-port.jpg', 3000, 4000)));
  assert.ok(d.w <= 720 && d.h <= 1280, `${d.w}×${d.h}`);
  assert.equal(d.w, 720);
  assert.equal(d.h, 960);
});

test('a wide 16:9 upload lands on exactly 1280×720', async () => {
  const d = await dims(await prepareImage(await photo('inspect-test-wide.jpg', 1920, 1080)));
  assert.deepEqual([d.w, d.h], [1280, 720]);
});

test('a small photo is never enlarged', async () => {
  const d = await dims(await prepareImage(await photo('inspect-test-small.jpg', 640, 480)));
  assert.deepEqual([d.w, d.h], [640, 480]);
});

test('the box is configurable', async () => {
  const d = await dims(await prepareImage(await photo('inspect-test-box.jpg', 4000, 3000), { long: 640, short: 360 }));
  assert.deepEqual([d.w, d.h], [480, 360]);
});

test('a missing file is null, not a throw', async () => {
  assert.equal(await prepareImage('/uploads/does-not-exist.jpg'), null);
});
