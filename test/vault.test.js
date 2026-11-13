// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVaultClient, VaultApiError } from '../src/vault.js';

const reply = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

function client(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return { vault: createVaultClient({ baseUrl: 'https://vault.test', fetchImpl }), calls };
}

test('a login is sent with no cookies, no referrer and no redirects, and its key is returned', async () => {
  const { vault, calls } = client(() => reply(200, { account_id: 'acc', api_key: 'k', keyring: { blob: '{}' } }));
  const session = await vault.login('alice', 'hash');
  assert.equal(session.api_key, 'k');
  const { url, init } = calls[0];
  assert.equal(url, 'https://vault.test/v1/login');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(init.body), { username: 'alice', auth_hash: 'hash', device_label: 'Web browser' });
});

test('failures are named by meaning: wrong credentials, locked, offline, server, malformed', async () => {
  const kind = async (handler, run) => {
    const { vault } = client(handler);
    await assert.rejects(run(vault), (error) => error instanceof VaultApiError);
    try { await run(vault); } catch (error) { return error; }
  };
  assert.equal((await kind(() => reply(401), (v) => v.login('a', 'h'))).kind, 'credentials');
  assert.equal((await kind(() => reply(401), (v) => v.readAll('k'))).kind, 'unauthorized');
  const locked = await kind(() => reply(429, {}, { 'Retry-After': '900' }), (v) => v.login('a', 'h'));
  assert.deepEqual([locked.kind, locked.retryAfter], ['locked', 900]);
  assert.equal((await kind(() => reply(503), (v) => v.prelogin('a'))).kind, 'server');
  assert.equal((await kind(() => { throw new TypeError('network'); }, (v) => v.prelogin('a'))).kind, 'offline');
  assert.equal((await kind(() => reply(200, { api_key: 1 }), (v) => v.login('a', 'h'))).kind, 'malformed');
});

test('every page of records is read, with the key as a bearer token', async () => {
  const pages = [
    { records: [{ id: 'a' }, { id: 'b' }], cursor: 2, has_more: true },
    { records: [{ id: 'c' }], cursor: 3, has_more: false },
  ];
  const { vault, calls } = client((url, init, n) => reply(200, pages[n - 1]));
  const records = await vault.readAll('device-key');
  assert.deepEqual(records.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer device-key');
  assert.ok(calls[0].url.endsWith('/v1/sync?since=0') && calls[1].url.endsWith('/v1/sync?since=2'));
});

test('a server that never advances its cursor cannot keep the viewer reading forever', async () => {
  const { vault, calls } = client(() => reply(200, { records: [], cursor: 0, has_more: true }));
  await vault.readAll('k');
  assert.equal(calls.length, 1);
});

test('logging out never throws, even when the vault cannot be reached', async () => {
  const { vault } = client(() => { throw new TypeError('network'); });
  await vault.logout('k');
});

test('two-factor login: the server asking for a code and a wrong code are named, not "wrong passphrase"', async () => {
  const kindOf = async (body) => {
    const { vault } = client(() => reply(401, body));
    try { await vault.login('a', 'h'); } catch (error) { return error.kind; }
    return null;
  };
  assert.equal(await kindOf({ detail: { error: 'two_factor_required' } }), 'twoFactorRequired');
  assert.equal(await kindOf({ detail: { error: 'invalid_two_factor' } }), 'invalidTwoFactor');
  assert.equal(await kindOf({ detail: { error: 'invalid_credentials' } }), 'credentials');
  assert.equal(await kindOf({ detail: 'Not authenticated' }), 'credentials');
});

test('a second factor is sent only when given, under the protocol field names', async () => {
  const { vault, calls } = client(() => reply(200, { account_id: 'acc', api_key: 'k', keyring: { blob: '{}' } }));
  await vault.login('alice', 'hash', { totpCode: '123456' });
  await vault.login('alice', 'hash', { recoveryCode: 'abcd-efgh' });
  await vault.login('alice', 'hash');
  assert.equal(JSON.parse(calls[0].init.body).totp_code, '123456');
  assert.equal(JSON.parse(calls[0].init.body).recovery_code, undefined);
  assert.equal(JSON.parse(calls[1].init.body).recovery_code, 'abcd-efgh');
  assert.deepEqual(Object.keys(JSON.parse(calls[2].init.body)).sort(), ['auth_hash', 'device_label', 'username']);
});
