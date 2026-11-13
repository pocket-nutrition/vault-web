// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { fetchReferenceTable, ReferenceIntakesError } from '../src/referenceIntakes.js';

const row = (overrides = {}) => ({
  nutrient: 'Iron', nutrientKey: 'ironMg', classification: 'Minerals', population: 'Adults', populationDescription: 'Adults',
  ageFrom: 18, ageTo: 999, ageUnit: 'y', pal: null, isMale: true, isFemale: false, valueKind: 'pri', raw: '11',
  valueMin: 11, valueMax: 11, isIncrement: false, unit: 'mg/day', sourceLink: 'https://example.test/iron', ...overrides,
});

function fakeFetch(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
  };
  return { calls, fetchImpl };
}

test('the table is fetched with no parameter, credential or referrer, and rows are kept', async () => {
  const { calls, fetchImpl } = fakeFetch({ status: 200, body: { source: 'EFSA', sourceUrl: 'https://efsa.test', values: [row(), row({ valueKind: 7 })] } });
  const table = await fetchReferenceTable({ baseUrl: 'https://api.test', fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.test/reference-intakes');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(Object.keys(calls[0].init.headers), ['Accept']);
  assert.equal(table.source, 'EFSA');
  assert.equal(table.rows.length, 1, 'the malformed row is dropped');
  assert.equal(table.rows[0].sourceLink, 'https://example.test/iron');
  assert.equal('raw' in table.rows[0], false);
});

test('offline, a server error, or a table with no usable row are errors the page can word', async () => {
  await assert.rejects(fetchReferenceTable({ fetchImpl: fakeFetch(new TypeError('down')).fetchImpl }), (e) => e instanceof ReferenceIntakesError && e.message === 'offline');
  await assert.rejects(fetchReferenceTable({ fetchImpl: fakeFetch({ status: 503, body: {} }).fetchImpl }), /server/);
  await assert.rejects(fetchReferenceTable({ fetchImpl: fakeFetch({ status: 200, body: { values: [] } }).fetchImpl }), /empty/);
  await assert.rejects(fetchReferenceTable({ fetchImpl: fakeFetch({ status: 200, body: [] }).fetchImpl }), /malformed/);
});

test('the CSP allows exactly the vault and the API as network destinations, and nothing inline', () => {
  const conf = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
  const csp = /Content-Security-Policy "([^"]+)"/.exec(conf)[1];
  assert.equal(csp, "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; " +
    "connect-src https://vault.pocketnutrition.org https://api.pocketnutrition.org; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
});
