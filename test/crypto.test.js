// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import sodium from 'libsodium-wrappers-sumo';

import { createCrypto, CryptoError } from '../src/crypto.js';

await sodium.ready;
const crypto = createCrypto(sodium);
const vectors = JSON.parse(readFileSync(new URL('./test-vectors.json', import.meta.url)));
const hex = (bytes) => sodium.to_hex(bytes);

test('the login hash and wrap key match the shared known answers (same as iOS and the server)', () => {
  const v = vectors.kdf;
  const kdf = {
    alg: 'argon2id', salt: sodium.to_base64(sodium.from_hex(v.salt_hex), sodium.base64_variants.ORIGINAL),
    opslimit: v.opslimit, memlimit: v.memlimit,
  };
  const { authHash, wrapKey } = crypto.deriveCredentials(v.passphrase_utf8, kdf);
  assert.equal(authHash, v.auth_hash_b64);
  assert.equal(hex(wrapKey), v.wrap_key_hex);
});

test('a record sealed by the other clients opens with its exact metadata, and with nothing else', () => {
  const v = vectors.record_aead;
  const key = sodium.from_hex(v.key_hex);
  assert.equal(new TextDecoder().decode(crypto.open(v.ciphertext_b64, key, v.aad_utf8)), v.plaintext_utf8);
  assert.throws(() => crypto.open(v.ciphertext_b64, key, v.aad_utf8.replace('|3|', '|4|')), CryptoError);
  assert.throws(() => crypto.open(v.ciphertext_b64, sodium.randombytes_buf(32), v.aad_utf8), CryptoError);
});

test('the passphrase is normalised so an accent typed either way derives the same keys', () => {
  const kdf = { alg: 'argon2id', salt: sodium.to_base64(new Uint8Array(16), sodium.base64_variants.ORIGINAL), opslimit: 3, memlimit: 64 * 1024 * 1024 };
  const composed = crypto.deriveCredentials('café au lait', kdf);
  const decomposed = crypto.deriveCredentials('café au lait', kdf);
  assert.equal(composed.authHash, decomposed.authHash);
});

test('weak or malformed key-derivation settings from a server are refused', () => {
  const salt = sodium.to_base64(new Uint8Array(16), sodium.base64_variants.ORIGINAL);
  const ok = { alg: 'argon2id', salt, opslimit: 3, memlimit: 64 * 1024 * 1024 };
  assert.ok(crypto.isAcceptableKdf(ok));
  for (const bad of [
    { ...ok, alg: 'argon2i' }, { ...ok, opslimit: 2 }, { ...ok, opslimit: 11 }, { ...ok, memlimit: 1024 },
    { ...ok, salt: sodium.to_base64(new Uint8Array(8), sodium.base64_variants.ORIGINAL) }, { ...ok, salt: '!!' }, null,
  ]) {
    assert.equal(crypto.isAcceptableKdf(bad), false);
    assert.throws(() => crypto.deriveCredentials('x'.repeat(12), bad), CryptoError);
  }
});

test('an empty passphrase derives nothing', () => {
  const salt = sodium.to_base64(new Uint8Array(16), sodium.base64_variants.ORIGINAL);
  assert.throws(
    () => crypto.deriveCredentials('', { alg: 'argon2id', salt, opslimit: 3, memlimit: 64 * 1024 * 1024 }), CryptoError);
});

test('the user key comes out of the keyring only for the right wrap key, and only for the passphrase slot', () => {
  const wrapKey = sodium.randombytes_buf(32);
  const userKey = sodium.randombytes_buf(32);
  const wrap = (key, aad) => {
    const nonce = sodium.randombytes_buf(24);
    const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(userKey, new TextEncoder().encode(aad), null, nonce, key);
    const all = new Uint8Array(24 + sealed.length);
    all.set(nonce); all.set(sealed, 24);
    return sodium.to_base64(all, sodium.base64_variants.ORIGINAL);
  };
  const blob = (aad) => JSON.stringify({ v: 1, kdf: {}, passphrase_wrapped_user_key: wrap(wrapKey, aad) });

  assert.deepEqual(crypto.unwrapUserKey(blob('pnv1|keyring|passphrase'), wrapKey).userKey, userKey);
  assert.throws(() => crypto.unwrapUserKey(blob('pnv1|keyring|recovery'), wrapKey), CryptoError);
  assert.throws(() => crypto.unwrapUserKey(blob('pnv1|keyring|passphrase'), sodium.randombytes_buf(32)), CryptoError);
  assert.throws(() => crypto.unwrapUserKey('not json', wrapKey), CryptoError);
  assert.throws(() => crypto.unwrapUserKey(JSON.stringify({ v: 2 }), wrapKey), CryptoError);
});

test('records not under the user key, or deleted, or tampered with, are skipped rather than trusted', () => {
  const key = sodium.randombytes_buf(32);
  const seal = (record, plaintext) => {
    const nonce = sodium.randombytes_buf(24);
    const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      new TextEncoder().encode(plaintext), new TextEncoder().encode(crypto.recordAAD('acc', record)), null, nonce, key);
    const all = new Uint8Array(24 + sealed.length);
    all.set(nonce); all.set(sealed, 24);
    return sodium.to_base64(all, sodium.base64_variants.ORIGINAL);
  };
  const record = { id: 'r1', type: 'meal', scope_id: null, revision: 2, key_id: 'user', deleted: false };
  const good = { ...record, ciphertext: seal(record, 'hello') };
  assert.equal(new TextDecoder().decode(crypto.openRecord('acc', key, good)), 'hello');
  assert.equal(crypto.openRecord('acc', key, { ...good, key_id: 'inbox' }), null);
  assert.equal(crypto.openRecord('acc', key, { ...good, deleted: true }), null);
  assert.equal(crypto.openRecord('acc', key, { ...good, revision: 3 }), null);
  assert.equal(crypto.openRecord('other-account', key, good), null);
});

test('KDF settings are compared field by field, not by their JSON', async () => {
  const { sameKdf } = await import('../src/crypto.js');
  const server = { alg: 'argon2id', salt: 'c2FsdA==', opslimit: 3, memlimit: 67108864 };
  const keyring = { alg: 'argon2id', memlimit: 67108864, opslimit: 3, salt: 'c2FsdA==' };
  assert.ok(sameKdf(keyring, server));
  assert.ok(!sameKdf({ ...keyring, opslimit: 2 }, server));
  assert.ok(!sameKdf({ ...keyring, salt: 'b3RoZXI=' }, server));
  assert.ok(!sameKdf(undefined, server));
});
