// SPDX-License-Identifier: AGPL-3.0-or-later

// The daily-targets view model: which targets apply on a day, the day's progress, the person's
// own recent days for nutrients with no target, the week and the trend. Pure: it reads the decrypted meals,
// the target settings from the vault and the reference table from the API, and computes in memory.

import { groupByDay } from './journal.js';
import { targetDetails } from './targets/dailyTargets.js';
import { dayProgress, roundFor, selfComparison } from './targets/dayProgress.js';
import { roundHalfUp } from './targets/rounding.js';
import { addDays, applyOverrides, latestOnOrBefore, profileForDay, unitOfKey } from './targets/targetHistory.js';
import { SALT_PER_SODIUM_MG } from './targets/nutrients.js';

export const WEEK_DAYS = 7;
export const TREND_LENGTHS = [7, 30, 90];

/** Salt in g from sodium in mg, one decimal, half-up. Display arithmetic only. */
export function saltFromSodium(mg) {
  return mg === null || mg === undefined ? null : roundHalfUp(mg * SALT_PER_SODIUM_MG * 10) / 10;
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * @param {{ settings: ReturnType<import('./targetRecords.js').emptyTargetSettings>, table: object[] | null, meals: object[] }} input
 */
export function createTargetModel({ settings, table, meals }) {
  const byDay = new Map(groupByDay(meals).map((day) => [day.day, day.meals]));
  const cache = new Map();
  const nutrientsOf = (day) => (byDay.get(day) ?? []).map((meal) => ({ nutrients: meal.nutrients }));

  /**
   * `{ status: 'none' }` (no profile and no override in force: totals only), `{ status: 'needs-table' }`,
   * `{ status: 'unsupported', reason }` or `{ status: 'ok', profile, targets }`. Without a profile, the
   * overrides in force alone make the targets (the "Skip, I'll enter my own values" path of the app).
   */
  function targetsFor(day) {
    if (cache.has(day)) return cache.get(day);
    const profile = profileForDay(settings.profiles, settings.weights, day);
    const overrides = latestOnOrBefore(settings.overrides, day);
    const hasOverrides = overrides !== null && Object.keys(overrides.values).length > 0;
    let result;
    if (profile === null && !hasOverrides) {
      result = { status: 'none' };
    } else if (profile !== null && table === null) {
      result = { status: 'needs-table', profile };
    } else {
      const computed = profile === null ? { status: 'ok', targets: [] } : targetDetails(table, profile);
      result = computed.status === 'ok'
        ? { status: 'ok', profile, targets: applyOverrides(computed.targets, settings.overrides, day) }
        : { status: 'unsupported', reason: computed.reason, profile };
    }
    cache.set(day, result);
    return result;
  }

  const targetList = (day) => {
    const targets = targetsFor(day);
    return targets.status === 'ok' ? targets.targets : [];
  };

  function progress(day, keys) {
    return dayProgress(targetList(day), nutrientsOf(day), keys);
  }

  /** The day's known total for [key], null when nothing is logged or no meal knows it. */
  function dayTotal(day, key) {
    if (!byDay.has(day)) return null;
    return dayProgress([], nutrientsOf(day), [key])[0].total;
  }

  function comparison(day, key) {
    const history = [];
    for (let i = WEEK_DAYS; i >= 1; i -= 1) {
      const date = addDays(day, -i);
      history.push({ date, total: dayTotal(date, key) });
    }
    return selfComparison(history, day, dayTotal(day, key));
  }

  /**
   * Seven days ending on [endDay]: for each key, the mean of the known daily totals and the mean percent of
   * each day's own target. Days with nothing logged, or where no meal knows the nutrient, are left out.
   */
  function week(endDay, keys) {
    const dates = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(endDay, i - WEEK_DAYS + 1));
    const logged = dates.filter((date) => byDay.has(date));
    const rows = keys.map((key) => {
      const days = logged.map((date) => ({ date, ...progress(date, [key])[0] })).filter((p) => p.total !== null);
      const withPercent = days.filter((p) => p.percent !== null);
      const unit = days[0]?.unit ?? unitOfKey(key);
      return {
        nutrientKey: key,
        unit,
        averageTotal: days.length ? roundFor(unit, mean(days.map((p) => p.total))) : null,
        averagePercent: withPercent.length ? roundHalfUp(mean(withPercent.map((p) => p.percent))) : null,
        daysKnown: days.length,
        daysWithTarget: withPercent.length,
      };
    });
    return { from: dates[0], to: endDay, daysLogged: logged.length, rows };
  }

  /** One point per day for [length] days ending on [endDay]: the known total and that day's target bounds. */
  function trend(endDay, length, key) {
    return Array.from({ length }, (_, i) => {
      const date = addDays(endDay, i - length + 1);
      const target = targetList(date).find((t) => t.nutrientKey === key) ?? null;
      return { date, total: dayTotal(date, key), min: target?.min ?? null, max: target?.max ?? null };
    });
  }

  /** The meals that brought the most of [key] on [day], largest first (records hold meal-level nutrients only). */
  function topMeals(day, key, count = 3) {
    return (byDay.get(day) ?? [])
      .filter((meal) => (meal.nutrients[key] ?? 0) > 0)
      .sort((a, b) => b.nutrients[key] - a.nutrients[key])
      .slice(0, count)
      .map((meal) => ({ meal, value: meal.nutrients[key] }));
  }

  return { targetsFor, progress, dayTotal, comparison, week, trend, topMeals, hasDay: (day) => byDay.has(day) };
}
