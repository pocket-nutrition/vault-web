// SPDX-License-Identifier: AGPL-3.0-or-later
// Ported from the sandbox's src/lib/dayProgress.ts (MPL-2.0), the reference implementation.
// Keep the two in step: test/vectors.test.js runs the shared `day-progress` and `self-comparison` suites
// against this file.
//
// How far a day has got toward its targets, for the watch-list rings, and how a day compares with the
// person's own recent days for nutrients that have no target. Unknown values are never counted as zero:
// a meal without a figure for a nutrient lowers the coverage instead.

import { roundHalfUp } from './rounding.js';
import { addDays, unitOfKey } from './targetHistory.js';

/**
 * @typedef {'no-target' | 'under' | 'ok' | 'over'} ProgressStatus
 * @typedef {object} NutrientProgress
 * @property {string} nutrientKey
 * @property {'kcal' | 'g' | 'mg' | 'µg'} unit
 * @property {number | null} total Sum of the known values, rounded (kcal and g whole, mg and µg one decimal).
 * @property {number} knownMeals
 * @property {number} totalMeals
 * @property {number | null} percent Known total / reference x 100, rounded half-up; reference is min, else max.
 * @property {ProgressStatus} status
 * @property {boolean} aboveUpperLimit
 */

/** Rounds like targets: kcal and g to whole numbers, mg and µg to one decimal. */
export function roundFor(unit, value) {
  return unit === 'kcal' || unit === 'g' ? roundHalfUp(value) : roundHalfUp(value * 10) / 10;
}

/**
 * Progress of the day's [meals] for each nutrient of [keys], in that order.
 *
 * Status, computed on the unrounded known total t (0 when no meal knows the nutrient):
 * no min and no max -> "no-target"; t < min -> "under"; max set and t > max -> "over"; otherwise "ok".
 * @param {Array<{ nutrientKey: string, unit: string, min: number | null, max: number | null, upperLimit: number | null }>} targets
 * @param {Array<{ nutrients: Record<string, number> }>} meals
 * @param {string[]} keys
 * @returns {NutrientProgress[]}
 */
export function dayProgress(targets, meals, keys) {
  const byKey = new Map(targets.map((t) => [t.nutrientKey, t]));
  return keys.map((key) => {
    const target = byKey.get(key);
    const unit = target?.unit ?? unitOfKey(key);
    const known = meals.filter((m) => Object.prototype.hasOwnProperty.call(m.nutrients, key));
    const sum = known.reduce((s, m) => s + m.nutrients[key], 0);
    const t = known.length > 0 ? sum : 0;
    const min = target?.min ?? null;
    const max = target?.max ?? null;
    const reference = min ?? max;

    let status;
    if (min === null && max === null) status = 'no-target';
    else if (min !== null && t < min) status = 'under';
    else if (max !== null && t > max) status = 'over';
    else status = 'ok';

    return {
      nutrientKey: key,
      unit,
      total: known.length > 0 ? roundFor(unit, sum) : null,
      knownMeals: known.length,
      totalMeals: meals.length,
      percent: reference === null || reference <= 0 ? null : roundHalfUp((t / reference) * 100),
      status,
      aboveUpperLimit: target?.upperLimit != null && t > target.upperLimit,
    };
  });
}

/**
 * Today against the person's own recent days, for a nutrient with no target. The window is the 7 calendar
 * days before [day], excluding [day]; days with no value are skipped, not counted as zero.
 * @param {Array<{ date: string, total: number | null }>} history
 * @param {string} day
 * @param {number | null} total
 * @returns {{ average: number | null, daysWithData: number, percentOfAverage: number | null }}
 */
export function selfComparison(history, day, total) {
  const from = addDays(day, -7);
  const days = history.filter((h) => h.date >= from && h.date < day && h.total !== null);
  if (days.length === 0) return { average: null, daysWithData: 0, percentOfAverage: null };
  const mean = days.reduce((s, h) => s + (h.total ?? 0), 0) / days.length;
  return {
    average: roundHalfUp(mean * 10) / 10,
    daysWithData: days.length,
    percentOfAverage: total === null || mean <= 0 ? null : roundHalfUp((total / mean) * 100),
  };
}
