// SPDX-License-Identifier: AGPL-3.0-or-later

// What the vault holds, as the viewer shows it. `meal` records are the journal (format: MealRecordPayload v1
// and v2 in the iOS app); `capture` records are voice dictations; `profile`, `targets` and `weight` records
// are the daily-targets settings (see targetRecords.js). Anything that does not open or does not parse is
// skipped, never shown half-trusted.

import { addTargetRecord, emptyTargetSettings, TARGET_RECORD_TYPES } from './targetRecords.js';
import { NUTRIENT_KEY_SET } from './targets/nutrients.js';

const decoder = new TextDecoder();

function parseJson(plaintext) {
  try {
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    return null;
  }
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Meal record versions this viewer reads. v2 adds an optional `slot` (ignored here) and `nutrients`. */
const READABLE_MEAL_VERSIONS = [1, 2];

const TOTALS_KEYS = { energy_kcal: 'energyKcal', protein_g: 'proteinG', carbohydrates_g: 'carbohydratesG', fat_g: 'fatG' };

/**
 * The meal's nutrients keyed like the API, for the targets: the saved v2 `nutrients` (which
 * already include a quick-add item's energy), else the four macros of `totals`. A key that is absent is
 * unknown, never 0.
 */
function mealNutrients(meal) {
  const source = meal.nutrients && typeof meal.nutrients === 'object' && !Array.isArray(meal.nutrients) ? meal.nutrients : null;
  const out = {};
  if (source) {
    for (const [key, value] of Object.entries(source)) if (NUTRIENT_KEY_SET.has(key) && isNumber(value)) out[key] = value;
    return out;
  }
  const totals = meal.totals ?? {};
  for (const [field, key] of Object.entries(TOTALS_KEYS)) if (isNumber(totals[field])) out[key] = totals[field];
  return out;
}

/** A meal from its plaintext, or null: wrong shape, a newer format, or naming another record. */
export function parseMeal(plaintext, expectedId) {
  const meal = parseJson(plaintext);
  if (!meal || !READABLE_MEAL_VERSIONS.includes(meal.v) || meal.id !== expectedId || !Array.isArray(meal.items)) return null;
  if (!isNumber(meal.saved_at) || !isNumber(meal.updated_at)) return null;
  const totals = meal.totals ?? {};
  return {
    id: meal.id,
    savedAt: meal.saved_at,
    updatedAt: meal.updated_at,
    totals: {
      kcal: isNumber(totals.energy_kcal) ? totals.energy_kcal : 0,
      protein: isNumber(totals.protein_g) ? totals.protein_g : 0,
      carbs: isNumber(totals.carbohydrates_g) ? totals.carbohydrates_g : 0,
      fat: isNumber(totals.fat_g) ? totals.fat_g : 0,
    },
    items: meal.items
      .filter((item) => item && typeof item.label === 'string' && isNumber(item.quantity_g))
      .map((item) => ({
        label: item.label,
        ingredientId: typeof item.ingredient_id === 'string' ? item.ingredient_id : '',
        grams: item.quantity_g,
        cooking: typeof item.cooking_method === 'string' ? item.cooking_method : '',
        state: typeof item.measured_state === 'string' ? item.measured_state : '',
      })),
    nutrients: mealNutrients(meal),
  };
}

/** A finished dictation: what was said and the foods heard. Null for anything else. */
export function parseDictation(plaintext, expectedId) {
  const payload = parseJson(plaintext);
  if (!payload || payload.v !== 1 || payload.record_id !== expectedId || payload.status !== 'done') return null;
  const result = payload.result;
  if (!result || typeof result.transcript !== 'string' || !Array.isArray(result.items)) return null;
  return {
    id: expectedId,
    transcript: result.transcript,
    heard: result.items.map((item) => item?.raw_text).filter((text) => typeof text === 'string'),
  };
}

/** Opens and parses everything readable. `openRecord(record)` returns plaintext bytes or null. */
export function readVault(records, openRecord) {
  const meals = [];
  const dictations = [];
  let targets = emptyTargetSettings();
  for (const record of records) {
    if (record.deleted) continue;
    const isTargetRecord = TARGET_RECORD_TYPES.has(record.type);
    if (record.type !== 'meal' && record.type !== 'capture' && !isTargetRecord) continue;
    const plaintext = openRecord(record);
    if (!plaintext) continue;
    if (isTargetRecord) {
      targets = addTargetRecord(targets, record, plaintext);
    } else if (record.type === 'meal') {
      const meal = parseMeal(plaintext, record.id);
      if (meal) meals.push(meal);
    } else {
      const dictation = parseDictation(plaintext, record.id);
      if (dictation) dictations.push(dictation);
    }
  }
  return { meals, dictations, targets };
}

/** Local calendar day, `YYYY-MM-DD`, of a timestamp in seconds. */
export function dayKey(seconds) {
  const date = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Newest day first, newest meal first within a day, with each day's totals. */
export function groupByDay(meals) {
  const days = new Map();
  for (const meal of [...meals].sort((a, b) => b.savedAt - a.savedAt)) {
    const key = dayKey(meal.savedAt);
    const day = days.get(key) ?? { day: key, meals: [], totals: { kcal: 0, protein: 0, carbs: 0, fat: 0 } };
    day.meals.push(meal);
    for (const field of Object.keys(day.totals)) day.totals[field] += meal.totals[field];
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/**
 * A cell as a spreadsheet will read it. Text starting with = + - @ (or a tab or return) would be run as a
 * formula by Excel and Sheets, and these labels come from product databases and from dictation: prefix
 * a quote so they stay text.
 */
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const CSV_HEADER = [
  'date', 'time', 'meal_id', 'ingredient', 'ingredient_id', 'grams', 'cooking', 'state',
  'meal_kcal', 'meal_protein_g', 'meal_carbs_g', 'meal_fat_g',
];

/** One row per ingredient, newest meal first. */
export function toCsv(meals) {
  const rows = [CSV_HEADER];
  for (const meal of [...meals].sort((a, b) => b.savedAt - a.savedAt)) {
    const when = new Date(meal.savedAt * 1000);
    const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
    const totals = [meal.totals.kcal, meal.totals.protein, meal.totals.carbs, meal.totals.fat].map((n) => Math.round(n * 10) / 10);
    const items = meal.items.length ? meal.items : [{ label: '', ingredientId: '', grams: '', cooking: '', state: '' }];
    for (const item of items) {
      rows.push([dayKey(meal.savedAt), time, meal.id, item.label, item.ingredientId, item.grams, item.cooking, item.state, ...totals]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
