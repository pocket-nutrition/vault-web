// SPDX-License-Identifier: AGPL-3.0-or-later

// Against a real vault server (a sibling `vault` checkout of https://github.com/pocket-nutrition/vault, SQLite,
// random port): an account built the way the iOS app builds one, meals written the way it writes them, then read
// back through this viewer's own code. Skipped when that checkout or its virtualenv is not there.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test, before, after } from 'node:test';
import sodium from 'libsodium-wrappers-sumo';

import { createCrypto, sameKdf } from '../src/crypto.js';
import { readVault } from '../src/journal.js';
import { createVaultClient } from '../src/vault.js';

const vaultDir = new URL('../../vault/', import.meta.url).pathname;
const python = `${vaultDir}.venv/bin/python`;
const skip = !existsSync(python);
const PORT = 18_000 + Math.floor(Math.random() * 1000);
const ORIGIN = 'https://me.example.org';
const base = `http://127.0.0.1:${PORT}`;

let server;
before(async () => {
  if (skip) return;
  await sodium.ready;
  server = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:build', '--factory', '--port', String(PORT), '--log-level', 'warning'],
    {
      cwd: vaultDir,
      env: { ...process.env, VAULT_DATABASE_URL: 'sqlite:///:memory:', VAULT_CORS_ORIGINS: ORIGIN, VAULT_PRELOGIN_SECRET: 'x' },
      stdio: 'ignore',
    });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('vault did not start');
});
after(() => server?.kill());

const b64 = (bytes) => sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
const enc = new TextEncoder();

function seal(plaintext, key, aad) {
  const nonce = sodium.randombytes_buf(24);
  const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, enc.encode(aad), null, nonce, key);
  const all = new Uint8Array(24 + sealed.length);
  all.set(nonce);
  all.set(sealed, 24);
  return b64(all);
}

const json = (body, headers = {}) => ({ headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('a vault built like the iOS app builds one is read back through the viewer', { skip }, async () => {
  const crypto = createCrypto(sodium);
  const passphrase = 'abacus-abdomen-abide-ablaze-able';
  const kdf = { alg: 'argon2id', salt: b64(sodium.randombytes_buf(16)), opslimit: 3, memlimit: 64 * 1024 * 1024 };
  const { authHash, wrapKey } = crypto.deriveCredentials(passphrase, kdf);
  const userKey = sodium.randombytes_buf(32);
  const inbox = sodium.crypto_box_keypair();
  const keyring = JSON.stringify({
    inbox_public_key: b64(inbox.publicKey),
    inbox_wrapped_secret_key: seal(inbox.privateKey, userKey, 'pnv1|keyring|inbox'),
    // The phones write the keyring with sorted keys, so its kdf is in a different field order from prelogin's.
    kdf: { alg: kdf.alg, memlimit: kdf.memlimit, opslimit: kdf.opslimit, salt: kdf.salt },
    passphrase_wrapped_user_key: seal(userKey, wrapKey, 'pnv1|keyring|passphrase'),
    recovery_wrapped_user_key: seal(userKey, sodium.randombytes_buf(32), 'pnv1|keyring|recovery'),
    v: 1,
  });

  const registered = await (await fetch(`${base}/v1/accounts`, {
    method: 'POST',
    ...json({ username: 'viewer-test', kdf, auth_hash: authHash, keyring, device_label: 'phone' }),
  })).json();
  assert.ok(registered.api_key, 'registration failed');

  const putRecord = async (id, type, revision, plaintext) => {
    const aad = ['pnv1', registered.account_id, id, type, '', String(revision), 'user'].join('|');
    const response = await fetch(`${base}/v1/records/${id}`, {
      method: 'PUT',
      ...json({ type, scope_id: null, revision, key_id: 'user', ciphertext: seal(plaintext, userKey, aad) },
        { Authorization: `Bearer ${registered.api_key}` }),
    });
    assert.equal(response.status, 200);
  };
  const meal = (id, label) => JSON.stringify({
    v: 1, id, saved_at: 1_700_000_000, updated_at: 1_700_000_000,
    items: [{ id: 'i', ingredient_id: 'apple', label, quantity_g: 120, cooking_method: 'raw', measured_state: 'raw' }],
    totals: { energy_kcal: 62, protein_g: 0.3, carbohydrates_g: 14, fat_g: 0.2 },
  });
  await putRecord('meal-one', 'meal', 1, meal('meal-one', 'Apple'));
  await putRecord('meal-two', 'meal', 1, meal('meal-two', 'Pear'));
  await putRecord('meal-two', 'meal', 2, meal('meal-two', 'Pear, edited'));

  // The viewer: prelogin, derive, log in, unwrap, read, decrypt.
  const vault = createVaultClient({ baseUrl: base });
  const announced = await vault.prelogin('viewer-test');
  const creds = crypto.deriveCredentials(passphrase, announced);
  const session = await vault.login('viewer-test', creds.authHash);
  const { userKey: unwrapped, kdf: stored } = crypto.unwrapUserKey(session.keyring.blob, creds.wrapKey);
  assert.notEqual(JSON.stringify(stored), JSON.stringify(announced), 'the two orders must differ for this check to mean anything');
  assert.ok(sameKdf(stored, announced), 'equal settings in another field order are the same settings');
  const records = await vault.readAll(session.api_key);
  const { meals } = readVault(records, (record) => crypto.openRecord(session.account_id, unwrapped, record));

  assert.deepEqual(meals.map((m) => m.items[0].label).sort(), ['Apple', 'Pear, edited']);

  // A wrong passphrase is a clean refusal, never keys.
  const wrong = crypto.deriveCredentials('wrong-wrong-wrong-wrong', announced);
  await assert.rejects(vault.login('viewer-test', wrong.authHash), { kind: 'credentials' });

  // The browser origin is allowed, another is not.
  const allowed = await fetch(`${base}/v1/server-info`, { headers: { Origin: ORIGIN } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), ORIGIN);
  const other = await fetch(`${base}/v1/server-info`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);

  await vault.logout(session.api_key);
  await assert.rejects(vault.readAll(session.api_key), { kind: 'unauthorized' });
});
