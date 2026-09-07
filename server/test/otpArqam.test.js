// OTP over WhatsApp via ARQAM.
//
// The behaviour worth pinning is the piece the provider does NOT do for us:
// ARQAM verifies by messageId, our routes only ever carry a phone, so the
// send→verify link lives in otp_pending. Every test below is really about
// that table being kept honest — replaced on resend, consumed on success,
// dropped on expiry, and capped on repeated wrong guesses.
//
// The module reads env at import time and talks to the network, so this file
// stubs global.fetch and imports it fresh with a fake key.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.ARQAM_API_KEY = 'otplive_test_key';
process.env.ARQAM_BASE_URL = 'https://otp.example.invalid/api';
process.env.DB_PATH = ':memory:';

const { sendCode, checkCode, otpConfigured, otpRequired } = await import('../src/otp.js');
const { db } = await import('../src/db.js');

const PHONE = '07701234567';
let calls = [];
let responder = () => ({ status: 200, body: { success: true, messageId: 'msg-1', status: 'sent' } });
const realFetch = global.fetch;

const DEFAULT_SEND = { status: 200, body: { success: true, messageId: 'msg-1', status: 'sent' } };

beforeEach(() => {
  calls = [];
  // Reset the stub too. Without this a responder that asserts on one URL
  // leaks into the next test's sendCode, throws inside fetch, and shows up
  // as a mysterious transport failure two tests later.
  responder = () => DEFAULT_SEND;
  db.prepare('DELETE FROM otp_pending').run();
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body });
    const r = responder(String(url), body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    };
  };
});
afterEach(() => { global.fetch = realFetch; });

const pending = () => db.prepare('SELECT * FROM otp_pending WHERE phone=?').get(PHONE);

test('configured from the API key alone; OTP stays off until the flag is set', () => {
  assert.equal(otpConfigured(), true);
  assert.equal(otpRequired(), false, 'a key present is not the same as OTP switched on');
});

test('send posts an E.164 number with the key in the header, and remembers the messageId', async () => {
  const r = await sendCode(PHONE);
  assert.equal(r.ok, true);
  assert.equal(r.channel, 'whatsapp');

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sms\/otp$/);
  assert.equal(calls[0].headers['X-API-Key'], 'otplive_test_key');
  assert.equal(calls[0].body.phoneNumber, '+9647701234567', '07… must become +9647…');
  assert.equal(calls[0].body.otpCode, undefined,
    'let ARQAM generate the code — holding a live secret ourselves buys nothing');

  assert.equal(pending().message_id, 'msg-1');
});

test('a bad local number never reaches the network', async () => {
  const r = await sendCode('9647701234567');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'bad_phone');
  assert.equal(calls.length, 0);
});

test('resending replaces the pending code and resets attempts', async () => {
  await sendCode(PHONE);
  db.prepare('UPDATE otp_pending SET attempts=3 WHERE phone=?').run(PHONE);

  responder = () => ({ status: 200, body: { success: true, messageId: 'msg-2', status: 'sent' } });
  await sendCode(PHONE);

  const p = pending();
  assert.equal(p.message_id, 'msg-2', 'the newest code is the one that works');
  assert.equal(p.attempts, 0, 'a fresh code deserves a fresh budget');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM otp_pending').get().n, 1, 'one row per phone');
});

test('a correct code verifies against the stored messageId, then is consumed', async () => {
  responder = () => ({ status: 200, body: { success: true, messageId: 'msg-7', status: 'sent' } });
  await sendCode(PHONE);

  responder = (url, body) => {
    assert.match(url, /\/sms\/verify$/);
    assert.equal(body.messageId, 'msg-7', 'verify must use the id from the send');
    return { status: 200, body: { verified: true } };
  };
  const r = await checkCode(PHONE, '123456');
  assert.equal(r.ok, true);
  assert.equal(r.approved, true);

  assert.equal(pending(), undefined,
    'consumed — otherwise the same code mints a second session for its whole window');
});

test('a wrong code is "not approved", not a provider failure', async () => {
  await sendCode(PHONE);
  responder = () => ({ status: 400, body: { error: 'INVALID_CODE' } });
  const r = await checkCode(PHONE, '000000');
  // ok:true means "we got an answer"; approved:false is that answer. The
  // route turns this into 401, not 502.
  assert.equal(r.ok, true);
  assert.equal(r.approved, false);
  assert.ok(pending(), 'a wrong guess must not throw the code away');
});

test('repeated wrong guesses are capped before the code space is', async () => {
  await sendCode(PHONE);
  responder = () => ({ status: 400, body: { error: 'INVALID_CODE' } });
  for (let i = 0; i < 5; i++) await checkCode(PHONE, '000000');

  const r = await checkCode(PHONE, '000000');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'otp_rate_limited');
  assert.equal(pending(), undefined, 'burn the code once the budget is spent');
});

test('verifying with nothing pending reads as expired, not wrong', async () => {
  const r = await checkCode(PHONE, '123456');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'otp_expired');
  assert.equal(calls.length, 0, 'no point asking the provider about a code we never sent');
});

test('an aged-out row is swept and never verified against', async () => {
  await sendCode(PHONE);
  db.prepare('UPDATE otp_pending SET created_at=? WHERE phone=?')
    .run(Date.now() - 11 * 60 * 1000, PHONE);
  const r = await checkCode(PHONE, '123456');
  assert.equal(r.error, 'otp_expired');
  assert.equal(pending(), undefined);
});

test("the provider's expiry also clears our row", async () => {
  await sendCode(PHONE);
  responder = () => ({ status: 400, body: { error: 'EXPIRED_CODE' } });
  const r = await checkCode(PHONE, '123456');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'otp_expired');
  assert.equal(pending(), undefined);
});

test('provider errors map to our vocabulary', async () => {
  const cases = [
    ['INVALID_PHONE', 400, 'bad_phone'],
    ['RATE_LIMIT_PHONE', 429, 'otp_rate_limited'],
    ['RATE_LIMIT_IP', 429, 'otp_rate_limited'],
    ['INSUFFICIENT_CREDITS', 402, 'otp_unavailable'],
    [null, 401, 'otp_not_configured'],
  ];
  for (const [code, status, expected] of cases) {
    responder = () => ({ status, body: code ? { error: code } : {} });
    const r = await sendCode(PHONE);
    assert.equal(r.ok, false);
    assert.equal(r.error, expected, `${code || status} should map to ${expected}`);
  }
});

test('a network failure fails closed and leaves nothing pending', async () => {
  global.fetch = async () => { throw new Error('socket hang up'); };
  const r = await sendCode(PHONE);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'otp_send_failed');
  assert.equal(pending(), undefined, 'no messageId means nothing to verify against');
});

test('a malformed code is rejected without a round trip', async () => {
  await sendCode(PHONE);
  const before = calls.length;
  for (const bad of ['', 'abc', '12', '1'.repeat(11)]) {
    const r = await checkCode(PHONE, bad);
    assert.equal(r.error, 'bad_code');
  }
  assert.equal(calls.length, before, 'never spend a request on input we can reject ourselves');
});
