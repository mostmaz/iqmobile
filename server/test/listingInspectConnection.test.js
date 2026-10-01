// The "test the key" button must answer without a network: a missing key is
// reported as such, by name, for the model in effect.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iq-inspect-conn-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-inspect-conn-secret';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
const { db, setSettingValue } = await import('../src/db.js');
const { testConnection, apiKeyFor, apiKeySourceFor, inspectionConfigured } = await import('../src/listingInspect.js');

after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('a missing key is named, for the vendor of the model in effect', async () => {
  const r = await testConnection();
  assert.equal(r.ok, false);
  assert.equal(r.model, 'gpt-6-luna');
  assert.equal(r.key_env, 'OPENAI_API_KEY');
  assert.match(r.error, /OPENAI_API_KEY/);

  setSettingValue('listing_inspection_model', 'claude-haiku-4-5');
  try {
    const c = await testConnection();
    assert.equal(c.ok, false);
    assert.equal(c.key_env, 'ANTHROPIC_API_KEY');
  } finally {
    setSettingValue('listing_inspection_model', '');
  }
});

test('a key pasted into the dashboard counts, and .env wins over it', () => {
  assert.equal(inspectionConfigured(), false);
  setSettingValue('listing_inspection_key_openai', 'sk-dash-1234');
  try {
    assert.equal(apiKeyFor(), 'sk-dash-1234');
    assert.equal(apiKeySourceFor(), 'dashboard');
    assert.equal(inspectionConfigured(), true);
    // The other vendor is untouched.
    assert.equal(apiKeyFor('claude-haiku-4-5'), '');
    process.env.OPENAI_API_KEY = 'sk-env-9999';
    try {
      assert.equal(apiKeyFor(), 'sk-env-9999');
      assert.equal(apiKeySourceFor(), 'env');
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
    setSettingValue('listing_inspection_key_openai', '');
    assert.equal(inspectionConfigured(), false);
  } finally {
    setSettingValue('listing_inspection_key_openai', '');
  }
});
