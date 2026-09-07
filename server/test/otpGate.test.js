// Where the OTP gate actually stands.
//
// The requirement is that verification happens exactly when someone claims a
// real phone number — signing in, which is what selling, chatting and saving
// all force — and never for plain browsing. These tests fix that boundary in
// place, including the two password endpoints that used to sit beside it as
// an unverified way to the same session.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the gate is where a phone is claimed, and nowhere else', async () => {
  // Read the routes rather than booting the server: this is a statement about
  // which endpoints consult otpRequired(), and that is visible in the source.
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/routes/auth.js', import.meta.url), 'utf8');

  // /guest mints a session with a SYNTHETIC phone. It claims no real number,
  // so it must stay open — this is what lets someone browse without signing
  // in at all, which is the whole point of not gating the app.
  const guest = src.slice(src.indexOf("r.post('/guest'"), src.indexOf("r.post('/login'"));
  assert.ok(!guest.includes('otpRequired'), '/guest must never require OTP');
  assert.ok(!guest.includes('passwordAuthClosed'), '/guest must never be closed');

  // /phone-login is the one place a real number is claimed.
  const phoneLogin = src.slice(src.indexOf("r.post('/phone-login'"));
  assert.ok(phoneLogin.includes('otpRequired()'), '/phone-login must consult the flag');

  // …and the password endpoints must not be an unverified way to the same
  // session while that flag is on.
  for (const route of ["r.post('/register'", "r.post('/login'"]) {
    const line = src.slice(src.indexOf(route), src.indexOf(route) + 120);
    assert.ok(
      line.includes('passwordAuthClosed'),
      `${route} can mint a session for any phone; it must be closed while OTP is required`,
    );
  }
});

test('one channel is offered, because only one can be honoured', async () => {
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/routes/auth.js', import.meta.url), 'utf8');
  const phoneLogin = src.slice(src.indexOf("r.post('/phone-login'"), src.indexOf("r.post('/otp/verify'"));
  assert.ok(
    !/req\.body\?\.channel/.test(phoneLogin),
    'the client must not pick a channel the provider does not expose',
  );
  assert.ok(
    !/'sms'/.test(phoneLogin),
    'no SMS branch of our own — ARQAM decides that for a number without WhatsApp',
  );
});
