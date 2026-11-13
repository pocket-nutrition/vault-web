// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { csvCell, groupByDay, parseDictation, parseMeal, readVault, toCsv } from '../src/journal.js';

const bytes = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

const mealJson = (overrides = {}) => ({
  v: 1, id: 'a1', saved_at: 1_700_000_000, updated_at: 1_700_000_100,
  items: [{ id: 'i1', ingredient_id: 'apple', label: 'Apple', quantity_g: 120, cooking_method: 'raw', measured_state: 'raw' }],
  totals: { energy_kcal: 62, protein_g: 0.3, carbohydrates_g: 14, fat_g: 0.2 },
  ...overrides,
});

test('a meal in the app format is read', () => {
  const meal = parseMeal(bytes(mealJson()), 'a1');
  assert.equal(meal.items[0].label, 'Apple');
  assert.equal(meal.items[0].grams, 120);
  assert.equal(meal.totals.kcal, 62);
});

test('a meal that is malformed, from a newer format, or meant for another record is not shown', () => {
  assert.equal(parseMeal(bytes('not json'), 'a1'), null);
  assert.equal(parseMeal(bytes(mealJson({ v: 3 })), 'a1'), null);
  assert.notEqual(parseMeal(bytes(mealJson({ v: 2, slot: 'lunch' })), 'a1'), null);
  assert.equal(parseMeal(bytes(mealJson({ id: 'other' })), 'a1'), null);
  assert.equal(parseMeal(bytes(mealJson({ items: 'x' })), 'a1'), null);
  assert.equal(parseMeal(bytes(mealJson({ saved_at: 'yesterday' })), 'a1'), null);
});

test('items with no usable label or weight are dropped, the rest kept', () => {
  const meal = parseMeal(bytes(mealJson({ items: [{ label: 'ok', quantity_g: 5 }, { label: 3 }, null, { label: 'x' }] })), 'a1');
  assert.deepEqual(meal.items.map((item) => item.label), ['ok']);
});

test('a dictation is read only when it is a finished one for this record', () => {
  const payload = { v: 1, record_id: 'c1', status: 'done', result: { transcript: 'deux oeufs', language: 'fr', items: [{ raw_text: 'deux oeufs' }] } };
  assert.deepEqual(parseDictation(bytes(payload), 'c1'), { id: 'c1', transcript: 'deux oeufs', heard: ['deux oeufs'] });
  assert.equal(parseDictation(bytes(payload), 'other'), null);
  assert.equal(parseDictation(bytes({ ...payload, status: 'failed' }), 'c1'), null);
});

test('only readable meal and dictation records make it through, and tombstones are ignored', () => {
  const records = [
    { id: 'a1', type: 'meal', deleted: false },
    { id: 'gone', type: 'meal', deleted: true },
    { id: 'locked', type: 'meal', deleted: false },
    { id: 'other', type: 'weight', deleted: false },
  ];
  const opened = readVault(records, (record) => (record.id === 'a1' ? bytes(mealJson()) : null));
  assert.equal(opened.meals.length, 1);
  assert.equal(opened.dictations.length, 0);
});

test('meals are grouped by day, newest first, with daily totals', () => {
  const day = (offsetDays, kcal) => ({
    id: String(offsetDays), savedAt: 1_700_000_000 - offsetDays * 86_400, updatedAt: 0, items: [],
    totals: { kcal, protein: 1, carbs: 2, fat: 3 },
  });
  const grouped = groupByDay([day(2, 100), day(0, 200), { ...day(0, 50), id: 'later', savedAt: 1_700_000_001 }]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].meals.map((meal) => meal.id), ['later', '0']);
  assert.equal(grouped[0].totals.kcal, 250);
  assert.equal(grouped[1].totals.kcal, 100);
});

test('CSV cells are quoted when needed and cannot run as spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(null), '');
});

test('the CSV has a header and one row per ingredient', () => {
  const meal = parseMeal(bytes(mealJson()), 'a1');
  const lines = toCsv([meal]).trimEnd().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('date,time,meal_id,ingredient'));
  assert.ok(lines[1].includes(',a1,Apple,apple,120,raw,raw,62,0.3,14,0.2'));
});
