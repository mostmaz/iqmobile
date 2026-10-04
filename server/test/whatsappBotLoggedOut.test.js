// A WhatsApp session that was logged out stays down until someone re-links.
//
// 3–4 Oct 2026: WhatsApp logged the linked device out, and every 15-minute
// sweep reconnected with the dead credentials anyway — the retry-forever
// pattern that gets a number flagged — and recorded each person it failed
// to reach as reminded. The LOGGED_OUT mark is what stops both, across
// restarts, and unlinking (the dashboard's re-link) is what clears it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'iqmobile-wa-'));
const AUTH = path.join(tmp, 'wa-auth');
fs.mkdirSync(AUTH);
fs.writeFileSync(path.join(AUTH, 'creds.json'), '{}');
fs.writeFileSync(path.join(AUTH, 'LOGGED_OUT'), '2026-10-03T06:25:05Z');
process.env.WHATSAPP_AUTH_DIR = AUTH;
process.env.WHATSAPP_PROVIDER = 'bot';
process.env.DB_PATH = path.join(tmp, 'test.db');

const bot = await import('../src/whatsappBot.js');
const { utilityConfigured } = await import('../src/whatsapp.js');

test('a logged-out session is not something to resume', () => {
  assert.equal(bot.botLinkable(), false, 'credentials on disk, but marked logged out');
  assert.equal(utilityConfigured(), false, 'so the sweep records nobody');
  assert.equal(bot.botStatus().connection, 'logged_out');
});

test('nothing reconnects with dead credentials', async () => {
  assert.equal(await bot.startBot(), null);
  assert.equal(bot.botStatus().connection, 'logged_out');
});

test('a send while logged out reports not_linked and touches nobody', async () => {
  const r = await bot.sendBotMessage('+9647700000001', 'test');
  assert.equal(r.ok, false);
  assert.equal(r.outcome, 'not_linked');
});

test('re-linking clears the mark', () => {
  bot.unlinkBot();
  assert.equal(fs.existsSync(path.join(AUTH, 'LOGGED_OUT')), false);
  assert.equal(bot.botStatus().connection, 'idle');
});
