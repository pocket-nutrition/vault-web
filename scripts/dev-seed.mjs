// SPDX-License-Identifier: AGPL-3.0-or-later

// Development only: creates an account with a few meals, a dictation and daily-targets settings in a LOCAL
// vault, built the way the iOS app builds one, so the page can be tried without a phone.
//   node scripts/dev-seed.mjs http://127.0.0.1:8000      (prints the username and passphrase)

import sodium from 'libsodium-wrappers-sumo';
import { createCrypto } from '../src/crypto.js';

const base = process.argv[2];
if (!base || /pocketnutrition\.org/.test(base)) throw new Error('Pass the URL of a LOCAL vault.');
await sodium.ready;
const crypto = createCrypto(sodium);
const b64 = (bytes) => sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
const enc = new TextEncoder();
const seal = (plaintext, key, aad) => {
  const nonce = sodium.randombytes_buf(24);
  const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, enc.encode(aad), null, nonce, key);
  const all = new Uint8Array(24 + sealed.length);
  all.set(nonce);
  all.set(sealed, 24);
  return b64(all);
};

const username = 'demo';
const passphrase = 'abacus-abdomen-abide-ablaze-able';
const kdf = { alg: 'argon2id', salt: b64(sodium.randombytes_buf(16)), opslimit: 3, memlimit: 64 * 1024 * 1024 };
const { authHash, wrapKey } = crypto.deriveCredentials(passphrase, kdf);
const userKey = sodium.randombytes_buf(32);
const inbox = sodium.crypto_box_keypair();
const keyring = JSON.stringify({
  inbox_public_key: b64(inbox.publicKey), inbox_wrapped_secret_key: seal(inbox.privateKey, userKey, 'pnv1|keyring|inbox'),
  // Sorted keys, as the phones write it: a different field order from what prelogin returns.
  kdf: { alg: kdf.alg, memlimit: kdf.memlimit, opslimit: kdf.opslimit, salt: kdf.salt },
  passphrase_wrapped_user_key: seal(userKey, wrapKey, 'pnv1|keyring|passphrase'),
  recovery_wrapped_user_key: seal(userKey, sodium.randombytes_buf(32), 'pnv1|keyring|recovery'), v: 1,
});
const post = (path, body, key) => fetch(`${base}/v1/${path}`, {
  method: path.startsWith('records') ? 'PUT' : 'POST',
  headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(body),
});
const reg = await (await post('accounts', { username, kdf, auth_hash: authHash, keyring, device_label: 'phone' })).json();
const put = (id, type, plaintext) => post(`records/${id}`, {
  type, scope_id: null, revision: 1, key_id: 'user',
  ciphertext: seal(plaintext, userKey, ['pnv1', reg.account_id, id, type, '', '1', 'user'].join('|')),
}, reg.api_key);

const now = Math.floor(Date.now() / 1000);
const meal = (id, hoursAgo, items, totals) => put(id, 'meal', JSON.stringify({
  v: 1, id, saved_at: now - hoursAgo * 3600, updated_at: now - hoursAgo * 3600,
  items: items.map(([label, g], i) => ({ id: `${id}-${i}`, ingredient_id: label.toLowerCase(), label, quantity_g: g, cooking_method: 'raw', measured_state: 'raw' })),
  totals,
}));
await meal('m1', 2, [['Apple', 120], ['Oats', 40]], { energy_kcal: 215, protein_g: 5, carbohydrates_g: 40, fat_g: 3 });
await meal('m2', 7, [['Chicken breast', 150], ['Rice', 180], ['=EVIL()', 10]], { energy_kcal: 640, protein_g: 48, carbohydrates_g: 70, fat_g: 12 });
await meal('m3', 30, [['Yogurt', 125]], { energy_kcal: 80, protein_g: 5, carbohydrates_g: 7, fat_g: 3 });
// v2 meals with full nutrients over the last ten days, and daily-targets settings (made-up values: this
// only exercises the views). The second meal of each day has no fibre, iron or sodium, to show coverage.
const dayOf = (daysAgo) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
for (let daysAgo = 1; daysAgo <= 10; daysAgo += 1) {
  const swing = 1 + ((daysAgo % 4) - 1.5) / 6;
  const nutrients = (scale, full) => Object.fromEntries(Object.entries({
    energyKcal: 900, proteinG: 38, carbohydratesG: 110, fatG: 30, sugarsG: 22, saturatedFatG: 9,
    ...(full ? { fiberG: 11, ironMg: 5.5, sodiumMg: 1300, vitaminDUg: 2.1, zincMg: 6 } : {}),
  }).map(([key, value]) => [key, Math.round(value * scale * swing * 10) / 10]));
  for (const [index, hour, full] of [[0, 12, true], [1, 19, false]]) {
    const id = `t${daysAgo}-${index}`;
    const at = now - daysAgo * 86_400 + (hour - new Date().getHours()) * 3600;
    const n = nutrients(index ? 0.9 : 1, full);
    await put(id, 'meal', JSON.stringify({
      v: 2, id, saved_at: at, updated_at: at, slot: index ? 'dinner' : 'lunch',
      items: [{ id: `${id}-0`, ingredient_id: 'dish', label: index ? 'Pasta, tomato sauce' : 'Lentil salad', quantity_g: 350, cooking_method: 'boiled', measured_state: 'cooked' }],
      totals: { energy_kcal: n.energyKcal, protein_g: n.proteinG, carbohydrates_g: n.carbohydratesG, fat_g: n.fatG },
      nutrients: n,
    }));
  }
}
await put('profile', 'profile', JSON.stringify({ version: 1, updated_at: now - 8 * 86_400, versions: [
  { effective_from: dayOf(8), birth_year: 1990, basis: 'male', situation: 'none', trimester: null, lactation: null, postmenopausal: null, pal: 1.6, weight_kg: 75, phytate_mg_per_day: null },
] }));
await put('targets', 'targets', JSON.stringify({ version: 1, updated_at: now - 3 * 86_400,
  overrides: [{ effective_from: dayOf(3), values: { sugarsG: { min: null, max: 50 } } }],
  watch_list: { preset: 'standard', keys: ['energyKcal', 'proteinG', 'carbohydratesG', 'fatG', 'fiberG', 'sugarsG', 'sodiumMg'] } }));
for (const [daysAgo, kg] of [[6, 76.2], [2, 75.4]]) {
  await put(`weight-${dayOf(daysAgo)}`, 'weight', JSON.stringify({ version: 1, updated_at: now - daysAgo * 86_400, date: dayOf(daysAgo), kg }));
}
await put('c1', 'capture', JSON.stringify({ v: 1, record_id: 'c1', ticket_id: 't', status: 'done', result: { transcript: 'two fried eggs and some rice', language: 'en', items: [{ raw_text: 'two fried eggs' }, { raw_text: 'some rice' }] }, error: null }));
console.log(`username: ${username}\npassphrase: ${passphrase}`);
