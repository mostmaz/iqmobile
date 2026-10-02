// The store reviewers' demo sign-in.
//
// Apple rejected 1.0.0 under 2.1(a): with OTP on, the WhatsApp code for the
// demo number in the review notes went to a phone the reviewer does not
// hold. The fix is one configured number that takes a fixed code. What has
// to hold: that number never reaches the paid provider, only its fixed code
// opens it, and every other number still goes through ARQAM.
//
// Through HTTP, because the bypass lives in the routes. Five calls at most:
// authLimiter allows five per minute per IP and this file shares one IP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-review-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.OTP_REQUIRED = 'true';
process.env.ARQAM_API_KEY = 'otplive_test_key';
process.env.ARQAM_BASE_URL = 'https://otp.example.invalid/api';
process.env.REVIEW_DEMO_PHONE = '07399999999';
process.env.REVIEW_DEMO_CODE = '482913';

// Local calls go to the test server; anything else is the provider.
const realFetch = global.fetch;
const providerCalls = [];
global.fetch = async (url, init) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  providerCalls.push({ url: String(url), body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ success: true, messageId: 'm1', channel: 'whatsapp' }) };
};

const { default: express } = await import('express');
const { db } = await import('../src/db.js');
const { default: authRoutes } = await import('../src/routes/auth.js');
const { isReviewPhone, reviewCodeMatches } = await import('../src/reviewLogin.js');

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
const server = http.createServer(app);
await new Promise((res) => server.listen(0, res));
const BASE = `http://127.0.0.1:${server.address().port}`;

async function call(p, body) {
  const res = await fetch(BASE + p, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test('the demo number asks for a code and sends none', async () => {
  const r = await call('/auth/phone-login', { phone: '0739 999 9999' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { otp_required: true, channel: 'whatsapp' });
  assert.equal(providerCalls.length, 0, 'nothing may be sent or billed for the demo number');
});

test('only the fixed code opens it', async () => {
  const wrong = await call('/auth/otp/verify', { phone: '07399999999', code: '000000' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, 'bad_code');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users WHERE phone=?').get('07399999999').n, 0);

  const ok = await call('/auth/otp/verify', { phone: '07399999999', code: '482913' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.ok(ok.data.token);
  assert.equal(ok.data.user.phone, '07399999999');
  assert.equal(providerCalls.length, 0);
});

test('every other number still goes to the provider', async () => {
  const r = await call('/auth/phone-login', { phone: '07701234567' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.otp_required, true);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].body.phoneNumber, '+9647701234567');
  // …and the fixed code does not open a real number.
  assert.equal(reviewCodeMatches('07701234567', '482913'), false);
});

test('off unless both halves are set and well-formed', () => {
  const saved = { p: process.env.REVIEW_DEMO_PHONE, c: process.env.REVIEW_DEMO_CODE };
  try {
    process.env.REVIEW_DEMO_CODE = '';
    assert.equal(isReviewPhone('07399999999'), false);
    process.env.REVIEW_DEMO_CODE = '12345';
    assert.equal(isReviewPhone('07399999999'), false);
    process.env.REVIEW_DEMO_CODE = saved.c;
    process.env.REVIEW_DEMO_PHONE = '12345';
    assert.equal(isReviewPhone('07399999999'), false);
  } finally {
    process.env.REVIEW_DEMO_PHONE = saved.p;
    process.env.REVIEW_DEMO_CODE = saved.c;
  }
});

test.after(() => { server.close(); db.close(); global.fetch = realFetch; });
