// End-to-end walk of the listing-video review pipeline against :4500.
// Seeds a seller + listing, uploads a tiny mp4, checks visibility at every
// stage (owner vs public vs admin), approves, rejects, and cleans up.
import 'dotenv/config';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

const db = new Database(process.env.DB_PATH || './data/iqmobile2.db');
const BASE = 'http://127.0.0.1:4500';
const t = Date.now();
let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + ' ' + extra); }
};

db.prepare("INSERT INTO users(phone, password_hash, display_name, governorate, created_at) VALUES('07798765432','x','v-test-seller','Baghdad',?)").run(t);
const sellerId = db.prepare("SELECT id FROM users WHERE phone='07798765432'").get().id;
const ins = db.prepare(
  `INSERT INTO phone_listings(seller_id, brand, model, storage, condition, accessories_json, asking_price,
    governorate, status, contact_phone, created_at, expires_at, updated_at)
   VALUES(?,?,?,?,?,'[]',?,?,?,?,?,?,?)`,
).run(sellerId, 'Samsung', 'Galaxy A55', '128GB', 'used', 350000, 'Baghdad', 'active', '07798765432', t, t + 31536000000, t);
const lid = ins.lastInsertRowid;

const SECRET = process.env.JWT_SECRET;
const sellerTok = jwt.sign({ id: sellerId, phone: '07798765432' }, SECRET, { expiresIn: '1h' });
const adminTok = jwt.sign({ id: 1, kind: 'admin', username: 't' }, SECRET, { expiresIn: '1h' });

// A tiny fake mp4 — the server validates mime + extension, not codec bytes.
fs.writeFileSync('/tmp/vtest.mp4', Buffer.concat([Buffer.from('\x00\x00\x00 ftypmp42', 'binary'), Buffer.alloc(2048)]));

const api = async (path, { method = 'GET', token, form, body } = {}) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) { payload = form; }
  else if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};
const mp4Form = () => {
  const fd = new FormData();
  fd.append('video', new Blob([fs.readFileSync('/tmp/vtest.mp4')], { type: 'video/mp4' }), 'clip.mp4');
  return fd;
};

// 1. upload (owner)
{
  const r = await api(`/listings/${lid}/video`, { method: 'POST', token: sellerTok, form: mp4Form() });
  ok(r.status === 200 && r.data?.video?.status === 'pending', 'owner upload → pending', JSON.stringify(r.data));
  const anon = await api(`/listings/${lid}`);
  ok(anon.data.video === null && !('video_path' in anon.data), 'anon detail hides pending video + raw columns');
  const own = await api(`/listings/${lid}`, { token: sellerTok });
  ok(own.data.video?.status === 'pending', 'owner sees pending video');
  const feed = await api(`/listings?limit=50`);
  const row = (feed.data.listings || feed.data).find?.((x) => x.id === lid);
  ok(row ? (!('video_path' in row) && row.has_video === false) : true, 'feed row: no raw path, has_video false');
}

// 2. wrong owner + wrong type
{
  const other = jwt.sign({ id: 1, phone: 'x' }, SECRET, { expiresIn: '1h' }); // user 1 is not the seller
  const r = await api(`/listings/${lid}/video`, { method: 'POST', token: other, form: mp4Form() });
  ok(r.status === 403, 'non-owner upload → 403');
  const fd = new FormData();
  fd.append('video', new Blob([Buffer.alloc(100)], { type: 'text/plain' }), 'x.txt');
  const bad = await api(`/listings/${lid}/video`, { method: 'POST', token: sellerTok, form: fd });
  ok(bad.status >= 400, 'non-video file rejected');
}

// 3. admin queue + approve
{
  const q = await api('/admin/videos?status=pending', { token: adminTok });
  ok(Array.isArray(q.data) && q.data.some((v) => v.id === lid), 'admin queue lists pending video');
  const wq = await api('/admin/work-queue', { token: adminTok });
  ok(wq.data.videos >= 1, `work-queue videos = ${wq.data.videos}`);
  const ap = await api(`/admin/videos/${lid}/approve`, { method: 'POST', token: adminTok });
  ok(ap.status === 200, 'approve ok');
  const anon = await api(`/listings/${lid}`);
  ok(anon.data.video?.status === 'approved', 'anon sees approved video');
  const feed = await api(`/listings?limit=50`);
  const row = (feed.data.listings || feed.data).find?.((x) => x.id === lid);
  ok(row ? row.has_video === true : true, 'feed has_video true after approval');
  const wq2 = await api('/admin/work-queue', { token: adminTok });
  ok(wq2.data.videos === 0, 'work-queue falls after approval');
}

// 4. re-upload replaces + reject deletes
{
  const r = await api(`/listings/${lid}/video`, { method: 'POST', token: sellerTok, form: mp4Form() });
  ok(r.status === 200 && r.data?.video?.status === 'pending', 're-upload → back to pending');
  const rej = await api(`/admin/videos/${lid}/reject`, { method: 'POST', token: adminTok });
  ok(rej.status === 200, 'reject ok');
  const row = db.prepare('SELECT video_path, video_status FROM phone_listings WHERE id=?').get(lid);
  ok(row.video_path === null && row.video_status === null, 'reject clears columns');
  const kinds = db.prepare("SELECT kind FROM notifications WHERE user_id=? ORDER BY id").all(sellerId).map((r2) => r2.kind);
  ok(kinds.includes('video.approved') && kinds.includes('video.rejected'), `seller notified (${kinds.join(',')})`);
}

// cleanup
db.prepare('DELETE FROM notifications WHERE user_id=?').run(sellerId);
db.prepare('DELETE FROM phone_listings WHERE id=?').run(lid);
db.prepare('DELETE FROM users WHERE id=?').run(sellerId);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
