// SPDX-License-Identifier: AGPL-3.0-or-later
// Ported from the sandbox's src/lib/targetHistory.ts (MPL-2.0), the reference implementation.
// Keep the two in step: test/vectors.test.js runs the shared `weight-for-day`, `profile-for-day` and
// `apply-target-overrides` suites against this file.
//
// Which profile, weight and target overrides apply on a given day, so that editing the profile or logging
// a weight changes that day's targets without rewriting the past. All dates are local calendar days written
// "YYYY-MM-DD"; they compare as strings.

import { roundHalfUp } from './rounding.js';

/**
 * @typedef {object} ProfileVersion One saved state of the questionnaire, in force from `effectiveFrom`.
 * @property {string} effectiveFrom
 * @property {number} birthYear
 * @property {'female' | 'male' | 'average'} basis
 * @property {'none' | 'pregnant' | 'lactating'} situation
 * @property {1 | 2 | 3} [trimester]
 * @property {'first-6-months' | 'after-6-months'} [lactation]
 * @property {boolean} [postmenopausal]
 * @property {number} pal
 * @property {number} weightKg
 * @property {number} [phytateMgPerDay]
 *
 * @typedef {{ date: string, kg: number }} WeightEntry
 * @typedef {{ min: number | null, max: number | null }} TargetOverride
 * @typedef {{ effectiveFrom: string, values: Record<string, TargetOverride> }} OverrideVersion
 */

export const WEIGHT_WINDOW_DAYS = 7;

/** `day` moved by `delta` calendar days. */
export function addDays(day, delta) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/** The latest item with effectiveFrom <= day; among equal dates the last one in the list wins. */
export function latestOnOrBefore(items, day) {
  let best = null;
  for (const item of items) {
    if (item.effectiveFrom > day) continue;
    if (best === null || item.effectiveFrom >= best.effectiveFrom) best = item;
  }
  return best;
}

/**
 * The weight to compute with on [day]: the mean of the entries of the 7 calendar days ending on [day]
 * (inclusive), rounded to one decimal. With no entry in that window, the most recent earlier entry; with
 * none at all, null. Entries after [day] are ignored, so a past day keeps the weight known then.
 * @param {WeightEntry[]} entries
 * @param {string} day
 * @returns {number | null}
 */
export function weightForDay(entries, day) {
  const windowStart = addDays(day, -(WEIGHT_WINDOW_DAYS - 1));
  const inWindow = entries.filter((e) => e.date >= windowStart && e.date <= day);
  if (inWindow.length > 0) {
    const mean = inWindow.reduce((sum, e) => sum + e.kg, 0) / inWindow.length;
    return roundHalfUp(mean * 10) / 10;
  }
  const earlier = entries.filter((e) => e.date < windowStart);
  if (earlier.length === 0) return null;
  return earlier.reduce((a, b) => (b.date >= a.date ? b : a)).kg;
}

/**
 * The profile in force on [day], ready for dailyTargets(): the latest version on or before the day, with
 * the age on that day (calendar year minus birth year) and the weight from the log when it has one.
 * Null before the first version.
 * @param {ProfileVersion[]} versions
 * @param {WeightEntry[]} weights
 * @param {string} day
 */
export function profileForDay(versions, weights, day) {
  const version = latestOnOrBefore(versions, day);
  if (version === null) return null;
  const profile = {
    ageYears: Number(day.slice(0, 4)) - version.birthYear,
    basis: version.basis,
    situation: version.situation,
    pal: version.pal,
    weightKg: weightForDay(weights, day) ?? version.weightKg,
  };
  if (version.trimester !== undefined) profile.trimester = version.trimester;
  if (version.lactation !== undefined) profile.lactation = version.lactation;
  if (version.postmenopausal !== undefined) profile.postmenopausal = version.postmenopausal;
  if (version.phytateMgPerDay !== undefined) profile.phytateMgPerDay = version.phytateMgPerDay;
  return profile;
}

export function unitOfKey(key) {
  if (key.endsWith('Kcal')) return 'kcal';
  if (key.endsWith('Ug')) return 'µg';
  if (key.endsWith('Mg')) return 'mg';
  return 'g';
}

/**
 * The computed [targets] with the overrides in force on [day] applied. An override replaces min and max
 * and keeps the EFSA upper limit and sources; an override on a nutrient with no computed target adds one
 * with no upper limit and no source. Sorted by nutrientKey. Extra fields of a target are kept.
 * @param {Array<object>} targets
 * @param {OverrideVersion[]} versions
 * @param {string} day
 */
export function applyOverrides(targets, versions, day) {
  const values = latestOnOrBefore(versions, day)?.values ?? {};
  const out = targets.map((t) => {
    const o = values[t.nutrientKey];
    return o === undefined ? { ...t, overridden: false } : { ...t, min: o.min, max: o.max, overridden: true };
  });
  const known = new Set(targets.map((t) => t.nutrientKey));
  for (const [key, o] of Object.entries(values)) {
    if (known.has(key)) continue;
    out.push({ nutrientKey: key, unit: unitOfKey(key), min: o.min, max: o.max, upperLimit: null, sources: [], overridden: true });
  }
  return out.sort((a, b) => a.nutrientKey.localeCompare(b.nutrientKey));
}
