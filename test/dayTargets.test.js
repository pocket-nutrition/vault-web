// SPDX-License-Identifier: AGPL-3.0-or-later

// The day-targets model end to end on a small made-up table (test data only: the page ships no value).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTargetModel, saltFromSodium } from '../src/dayTargets.js';
import { targetDetails } from '../src/targets/dailyTargets.js';
import { emptyTargetSettings } from '../src/targetRecords.js';

const row = (key, valueKind, valueMin, unit, overrides = {}) => ({
  nutrient: key, nutrientKey: key, population: 'Adults', populationDescription: 'Adults', ageFrom: 18, ageTo: 999,
  ageUnit: 'y', pal: null, isMale: true, isFemale: true, valueKind, valueMin, valueMax: valueMin, isIncrement: false,
  unit, sourceLink: `src/${key}`, ...overrides,
});
const TABLE = [
  row('energyKcal', 'ar_kcal', 2000, 'kcal/day', { pal: 1.6 }),
  row('energyKcal', 'ar_kcal', 2400, 'kcal/day', { pal: 2.0 }),
  row('proteinG', 'pri', 1, 'g/kg bw per day'),
  row('ironMg', 'ai', 10, 'mg/day'),
  row('ironMg', 'ul', 40, 'mg/day'),
];

const at = (day, hour) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime() / 1000;
const meal = (id, day, nutrients, hour = 12) => ({ id, savedAt: at(day, hour), updatedAt: 0, items: [], totals: {}, nutrients });
const version = (effectiveFrom, extra = {}) => ({
  effectiveFrom, birthYear: 1990, basis: 'male', situation: 'none', pal: 1.6, weightKg: 70, ...extra,
});

test('target details name the EFSA value kind of each target', () => {
  const { targets } = targetDetails(TABLE, { ageYears: 36, basis: 'average', situation: 'none', pal: 1.6, weightKg: 70 });
  assert.deepEqual(targets.map((t) => [t.nutrientKey, t.valueKinds]), [['energyKcal', ['ar_kcal']], ['ironMg', ['ai']], ['proteinG', ['pri']]]);
});

test('no profile and no override: no target, the day shows totals only', () => {
  const model = createTargetModel({ settings: emptyTargetSettings(), table: TABLE, meals: [meal('a', '2026-11-06', { energyKcal: 500 })] });
  assert.deepEqual(model.targetsFor('2026-11-06'), { status: 'none' });
});

test('a day before the first profile has no target; a later weight changes that day and not the one before', () => {
  const settings = { ...emptyTargetSettings(), profiles: [version('2026-11-05')], weights: [{ date: '2026-11-06', kg: 80 }] };
  const model = createTargetModel({ settings, table: TABLE, meals: [] });
  assert.equal(model.targetsFor('2026-11-04').status, 'none');
  const protein = (day) => model.targetsFor(day).targets.find((t) => t.nutrientKey === 'proteinG').min;
  assert.equal(protein('2026-11-05'), 70);
  assert.equal(protein('2026-11-06'), 80);
});

test('with a profile but no table yet, the model says so instead of inventing a target', () => {
  const settings = { ...emptyTargetSettings(), profiles: [version('2026-11-01')] };
  assert.equal(createTargetModel({ settings, table: null, meals: [] }).targetsFor('2026-11-06').status, 'needs-table');
});

test('an unsupported profile is reported with its reason', () => {
  const settings = { ...emptyTargetSettings(), profiles: [version('2026-11-01', { birthYear: 2010, basis: 'female', situation: 'pregnant', trimester: 1 })] };
  assert.deepEqual(createTargetModel({ settings, table: TABLE, meals: [] }).targetsFor('2026-11-06').status, 'unsupported');
});

test('overrides apply on their day, and alone they make targets without a profile', () => {
  const overrides = [{ effectiveFrom: '2026-11-06', values: { energyKcal: { min: 2200, max: 2200 }, sugarsG: { min: null, max: 50 } } }];
  const withProfile = createTargetModel({ settings: { ...emptyTargetSettings(), profiles: [version('2026-11-01')], overrides }, table: TABLE, meals: [] });
  const energy = (model, day) => model.targetsFor(day).targets.find((t) => t.nutrientKey === 'energyKcal');
  assert.equal(energy(withProfile, '2026-11-05').min, 2000);
  assert.deepEqual([energy(withProfile, '2026-11-06').min, energy(withProfile, '2026-11-06').overridden], [2200, true]);
  const alone = createTargetModel({ settings: { ...emptyTargetSettings(), overrides }, table: null, meals: [] });
  assert.equal(alone.targetsFor('2026-11-05').status, 'none');
  assert.deepEqual(alone.targetsFor('2026-11-06').targets.map((t) => t.nutrientKey), ['energyKcal', 'sugarsG']);
});

test('progress counts unknowns as coverage, not zero, and the day is compared with the days before', () => {
  const meals = [
    meal('a', '2026-11-06', { energyKcal: 800, ironMg: 4 }, 8),
    meal('b', '2026-11-06', { energyKcal: 700, sodiumMg: 2000 }, 13),
    meal('c', '2026-11-05', { energyKcal: 1900, sodiumMg: 1000 }),
    meal('d', '2026-11-03', { energyKcal: 1800, sodiumMg: 3000 }),
  ];
  const model = createTargetModel({ settings: { ...emptyTargetSettings(), profiles: [version('2026-11-01')] }, table: TABLE, meals });
  const [energy, iron, sodium] = model.progress('2026-11-06', ['energyKcal', 'ironMg', 'sodiumMg']);
  assert.deepEqual([energy.total, energy.percent, energy.status], [1500, 75, 'under']);
  assert.deepEqual([iron.knownMeals, iron.totalMeals], [1, 2]);
  assert.equal(sodium.status, 'no-target');
  assert.deepEqual(model.comparison('2026-11-06', 'sodiumMg'), { average: 2000, daysWithData: 2, percentOfAverage: 100 });
  assert.deepEqual(model.topMeals('2026-11-06', 'energyKcal').map((m) => m.meal.id), ['a', 'b']);
});

test('the week averages known days only, against each day\'s own target; the trend steps with the profile', () => {
  const meals = [meal('a', '2026-11-06', { energyKcal: 2400 }), meal('b', '2026-11-04', { energyKcal: 1000 }), meal('c', '2026-11-05', { proteinG: 10 })];
  const settings = { ...emptyTargetSettings(), profiles: [version('2026-11-01'), version('2026-11-06', { pal: 2.0 })] };
  const model = createTargetModel({ settings, table: TABLE, meals });
  const { rows, daysLogged, from } = model.week('2026-11-06', ['energyKcal']);
  assert.equal(from, '2026-10-31');
  assert.equal(daysLogged, 3);
  // 1000 / 2000 = 50 % and 2400 / 2400 = 100 %; 5 November knows no energy and is left out.
  assert.deepEqual(rows[0], { nutrientKey: 'energyKcal', unit: 'kcal', averageTotal: 1700, averagePercent: 75, daysKnown: 2, daysWithTarget: 2 });
  const trend = model.trend('2026-11-06', 7, 'energyKcal');
  assert.equal(trend.length, 7);
  assert.deepEqual(trend.slice(-3).map((p) => [p.total, p.min]), [[1000, 2000], [null, 2000], [2400, 2400]]);
  assert.equal(trend[0].min, null, '31 October is before the first profile');
});

test('salt is sodium x 2.5 / 1000, one decimal, half-up', () => {
  assert.equal(saltFromSodium(2000), 5);
  assert.equal(saltFromSodium(2460), 6.2);
  assert.equal(saltFromSodium(null), null);
});
