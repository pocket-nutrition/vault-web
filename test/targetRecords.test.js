// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseMeal, readVault } from '../src/journal.js';
import { parseProfileRecord, parseTargetsRecord, parseWeightRecord } from '../src/targetRecords.js';

const bytes = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

// Example payloads of the `profile`, `targets` and `weight` records.
const profileJson = (overrides = {}) => ({
  version: 1, updated_at: 1_793_000_000,
  versions: [{
    effective_from: '2026-11-06', birth_year: 1996, basis: 'female', situation: 'pregnant', trimester: 2,
    lactation: null, postmenopausal: false, pal: 1.6, weight_kg: 65.0, phytate_mg_per_day: null,
  }],
  ...overrides,
});
const targetsJson = (overrides = {}) => ({
  version: 1, updated_at: 1_793_000_000,
  overrides: [{ effective_from: '2026-11-06', values: { energyKcal: { min: 2200, max: 2200 }, sugarsG: { min: null, max: 50 } } }],
  watch_list: { preset: 'standard', keys: ['energyKcal', 'proteinG', 'carbohydratesG', 'fatG', 'fiberG', 'sugarsG'] },
  ...overrides,
});
const weightJson = { version: 1, updated_at: 1_793_000_000, date: '2026-11-06', kg: 70.5 };

test('a profile record becomes the reference profile history, nulls dropped', () => {
  const { ok } = parseProfileRecord(bytes(profileJson()));
  assert.equal(ok.updatedAt, 1_793_000_000);
  assert.deepEqual(ok.versions, [{
    effectiveFrom: '2026-11-06', birthYear: 1996, basis: 'female', situation: 'pregnant', pal: 1.6, weightKg: 65,
    trimester: 2, postmenopausal: false,
  }]);
});

test('a profile with one bad version is rejected whole, and a newer version is reported', () => {
  const bad = profileJson();
  bad.versions.push({ ...bad.versions[0], basis: 'unknown' });
  assert.deepEqual(parseProfileRecord(bytes(bad)), { malformed: true });
  assert.deepEqual(parseProfileRecord(bytes(profileJson({ version: 2 }))), { newer: 2 });
  assert.deepEqual(parseProfileRecord(bytes('nope')), { malformed: true });
  assert.deepEqual(parseProfileRecord(bytes(profileJson({ versions: 'x' }))), { malformed: true });
});

test('a targets record gives the override snapshots and the watch list', () => {
  const { ok } = parseTargetsRecord(bytes(targetsJson()));
  assert.deepEqual(ok.overrides, [{ effectiveFrom: '2026-11-06', values: { energyKcal: { min: 2200, max: 2200 }, sugarsG: { min: null, max: 50 } } }]);
  assert.deepEqual(ok.watchList, { preset: 'standard', keys: ['energyKcal', 'proteinG', 'carbohydratesG', 'fatG', 'fiberG', 'sugarsG'] });
});

test('a watch list keeps known keys once, in order, and falls back to its preset', () => {
  const { ok } = parseTargetsRecord(bytes(targetsJson({ watch_list: { preset: 'custom', keys: ['ironMg', 'madeUpG', 'ironMg', 'sodiumMg'] } })));
  assert.deepEqual(ok.watchList.keys, ['ironMg', 'sodiumMg']);
  const fallback = parseTargetsRecord(bytes(targetsJson({ watch_list: { preset: 'kidney' } }))).ok;
  assert.deepEqual(fallback.watchList.keys, ['energyKcal', 'proteinG', 'potassiumMg', 'phosphorusMg', 'sodiumMg']);
  assert.equal(parseTargetsRecord(bytes(targetsJson({ watch_list: undefined }))).ok.watchList.preset, 'standard');
});

test('a targets record with a non-numeric bound is rejected', () => {
  const bad = targetsJson({ overrides: [{ effective_from: '2026-11-06', values: { energyKcal: { min: 'lots', max: null } } }] });
  assert.deepEqual(parseTargetsRecord(bytes(bad)), { malformed: true });
});

test('a weight record must carry the date of its id', () => {
  assert.deepEqual(parseWeightRecord(bytes(weightJson), 'weight-2026-11-06'), { ok: { date: '2026-11-06', kg: 70.5 } });
  assert.deepEqual(parseWeightRecord(bytes(weightJson), 'weight-2026-11-07'), { malformed: true });
  assert.deepEqual(parseWeightRecord(bytes({ ...weightJson, kg: -3 }), 'weight-2026-11-06'), { malformed: true });
  assert.deepEqual(parseWeightRecord(bytes({ ...weightJson, version: 7 }), 'weight-2026-11-06'), { newer: 7 });
});

test('the vault read collects target settings and reports what it cannot read, without failing', () => {
  const payloads = {
    profile: profileJson(),
    targets: targetsJson({ version: 3 }),
    'weight-2026-11-06': weightJson,
    'weight-2026-11-05': { ...weightJson, date: '2026-11-05', kg: 71 },
    'weight-bad': weightJson,
  };
  const records = Object.keys(payloads).map((id) => ({ id, type: id.startsWith('weight') ? 'weight' : id, deleted: false }));
  records.push({ id: 'weight-2026-11-01', type: 'weight', deleted: true });
  const { targets } = readVault(records, (record) => bytes(payloads[record.id]));
  assert.equal(targets.profiles.length, 1);
  assert.deepEqual(targets.weights.map((w) => w.kg).sort(), [70.5, 71]);
  assert.deepEqual(targets.newer, [{ type: 'targets', id: 'targets', version: 3 }]);
  assert.deepEqual(targets.malformed, [{ type: 'weight', id: 'weight-bad' }]);
  assert.equal(targets.hasTargetsRecord, false);
  assert.equal(targets.watchList.preset, 'standard');
});

test('meal nutrients: saved v2 nutrients, else the v1 totals; absent stays unknown', () => {
  const base = { id: 'a1', saved_at: 1, updated_at: 1, items: [], totals: { energy_kcal: 500, protein_g: 20, carbohydrates_g: 60, fat_g: 10 } };
  assert.deepEqual(parseMeal(bytes({ ...base, v: 1 }), 'a1').nutrients, { energyKcal: 500, proteinG: 20, carbohydratesG: 60, fatG: 10 });
  const v2 = parseMeal(bytes({ ...base, v: 2, nutrients: { energyKcal: 500, ironMg: 2.1, bogusG: 3, fiberG: 'x' } }), 'a1');
  assert.deepEqual(v2.nutrients, { energyKcal: 500, ironMg: 2.1 });
  assert.deepEqual(parseMeal(bytes({ ...base, v: 1, totals: { energy_kcal: 90 } }), 'a1').nutrients, { energyKcal: 90 });
});
