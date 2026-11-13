// SPDX-License-Identifier: AGPL-3.0-or-later

// The daily-targets views, read-only: watch-list rings on each day header, the day detail, the
// week, a trend for one nutrient and "How is this calculated". Rings never turn red: past 100 % a second
// lap is drawn in a muted tone. Salt is shown from sodium. Everything is computed by dayTargets.js.

import { saltFromSodium, TREND_LENGTHS, WEEK_DAYS } from './dayTargets.js';
import { externalLink, h, svg } from './dom.js';
import { DEFAULT_PHYTATE } from './targets/dailyTargets.js';
import { ACTIVITY_LEVELS, MEDICAL_PRESETS, NUTRIENT_GROUPS, NUTRIENT_KEYS, WEEKLY_KEYS } from './targets/nutrients.js';
import { weightForDay } from './targets/targetHistory.js';

const RING_RADIUS = 15.9155; // circumference 100, so a dash length is a percentage
const CHART = { width: 600, height: 160 };

/**
 * @param {{ tt: object, lang: string, formatDay: (day: string) => string, formatTime: (seconds: number) => string,
 *           navigate: (change: object) => void }} context
 */
export function createTargetsView({ tt, lang, formatDay, formatTime, navigate }) {
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  const dateFormatter = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' });

  const isSalt = (key, asSalt) => asSalt && key === 'sodiumMg';
  const name = (key, asSalt = true) => (isSalt(key, asSalt) ? tt.salt : tt.nutrients[key] ?? key);
  function amount(key, unit, value, asSalt = true) {
    if (value === null || value === undefined) return tt.unknown;
    return isSalt(key, asSalt) ? `${number.format(saltFromSodium(value))} g` : `${number.format(value)} ${unit}`;
  }
  function targetText(target, asSalt = true) {
    const show = (value) => amount(target.nutrientKey, target.unit, value, asSalt);
    const { min, max } = target;
    if (min !== null && max !== null) return min === max ? show(min) : tt.between(show(min), show(max));
    if (min !== null) return tt.atLeast(show(min));
    if (max !== null) return tt.upTo(show(max));
    return tt.status['no-target'];
  }
  const isLimit = (target) => target && target.min === null && target.max !== null;

  // MARK: - Rings

  function ring(percent, partial) {
    const value = Math.max(0, percent ?? 0);
    const lap = (cls, length) => svg('circle', {
      class: cls, cx: 18, cy: 18, r: RING_RADIUS, 'stroke-dasharray': `${length} 100`, transform: 'rotate(-90 18 18)',
    });
    return svg('svg', { class: partial ? 'ring partial' : 'ring', viewBox: '0 0 36 36', 'aria-hidden': 'true' },
      svg('circle', { class: 'ring-track', cx: 18, cy: 18, r: RING_RADIUS }),
      value > 0 ? lap('ring-fill', Math.min(value, 100)) : null,
      value > 100 ? lap('ring-over', Math.min(value - 100, 100)) : null);
  }

  function ringItem(model, day, progress, target) {
    const partial = progress.totalMeals > 0 && progress.knownMeals < progress.totalMeals;
    const key = progress.nutrientKey;
    if (progress.status === 'no-target') {
      const usual = model.comparison(day, key).average;
      const text = [`${name(key)} ${amount(key, progress.unit, progress.total)}`];
      if (usual !== null) text.push(tt.usual(amount(key, progress.unit, usual)));
      return h('span', { class: 'chip' }, text.join(' · '));
    }
    const title = [`${name(key)}: ${amount(key, progress.unit, progress.total)} / ${targetText(target)}`];
    if (partial) title.push(tt.coverage(progress.knownMeals, progress.totalMeals));
    return h('span', { class: 'ring-item', title: title.join(' · ') },
      ring(progress.percent, partial),
      h('span', { class: 'ring-label' }, name(key)),
      h('span', { class: 'ring-value' }, `${progress.percent ?? 0} %`),
      isLimit(target) ? h('span', { class: 'limit-marker' }, tt.limit) : null,
      partial ? h('span', { class: 'coverage' }, tt.coverage(progress.knownMeals, progress.totalMeals)) : null);
  }

  /** The watch-list rings of a day, or null when no target applies (the header then shows totals only). */
  function dayRings(model, day, keys, { interactive = true } = {}) {
    const targets = model.targetsFor(day);
    if (targets.status !== 'ok' || keys.length === 0) return null;
    const byKey = new Map(targets.targets.map((target) => [target.nutrientKey, target]));
    const items = model.progress(day, keys).map((p) => ringItem(model, day, p, byKey.get(p.nutrientKey)));
    return interactive
      ? h('button', { class: 'rings', 'aria-label': tt.openDay, onclick: () => navigate({ view: 'day', day }) }, items)
      : h('div', { class: 'rings' }, items);
  }

  // MARK: - Day detail

  function mealLabel(meal) {
    const labels = meal.items.slice(0, 2).map((item) => item.label);
    if (meal.items.length > 2) labels.push('…');
    return `${formatTime(meal.savedAt)}${labels.length ? ` ${labels.join(', ')}` : ''}`;
  }

  function detailRow(model, day, progress, target) {
    const key = progress.nutrientKey;
    const lines = [];
    const value = h('span', { class: 'detail-total' }, amount(key, progress.unit, progress.total, false));
    if (key === 'sodiumMg' && progress.total !== null) value.append(` (${tt.salt.toLowerCase()} ${amount(key, progress.unit, progress.total)})`);
    if (target && progress.status !== 'no-target') {
      lines.push(`${tt.target} ${targetText(target, false)} · ${tt.status[progress.status]} · ${progress.percent ?? 0} %`);
    } else {
      const usual = model.comparison(day, key).average;
      lines.push(usual === null ? tt.status['no-target'] : tt.usual(amount(key, progress.unit, usual, false)));
    }
    if (progress.totalMeals > 0 && progress.knownMeals < progress.totalMeals) lines.push(tt.coverage(progress.knownMeals, progress.totalMeals));
    if (progress.aboveUpperLimit) lines.push(tt.aboveUpper(amount(key, progress.unit, target.upperLimit, false)));
    const top = model.topMeals(day, key);
    if (top.length) lines.push(`${tt.topMeals} ${top.map(({ meal, value: v }) => `${mealLabel(meal)} (${amount(key, progress.unit, v, false)})`).join(' · ')}`);
    return h('li', { class: 'detail-row' },
      h('div', { class: 'detail-head' }, h('span', {}, tt.nutrients[key]), value),
      lines.map((line) => h('p', { class: 'soft' }, line)),
      WEEKLY_KEYS.has(key)
        ? h('button', { class: 'link', onclick: () => navigate({ view: 'tab', tab: 'targets', weekEnd: day }) }, tt.seeWeek)
        : null);
  }

  function dayDetail(model, day, keys) {
    const targets = model.targetsFor(day);
    const byKey = new Map(targets.status === 'ok' ? targets.targets.map((target) => [target.nutrientKey, target]) : []);
    const progress = new Map(model.progress(day, NUTRIENT_KEYS).map((p) => [p.nutrientKey, p]));
    return h('section', {},
      h('header', { class: 'bar' },
        h('button', { class: 'quiet', onclick: () => navigate({ view: 'tab', tab: 'journal' }) }, `← ${tt.back}`),
        h('button', { class: 'quiet', onclick: () => navigate({ view: 'tab', tab: 'targets', explainDay: day }) }, tt.explain)),
      h('h2', {}, h('span', { class: 'day-title' }, formatDay(day))),
      dayRings(model, day, keys, { interactive: false }),
      targets.status === 'none' ? h('p', { class: 'notice' }, tt.nothingSet) : null,
      targets.status === 'unsupported' ? h('p', { class: 'notice' }, tt.unsupported) : null,
      Object.entries(NUTRIENT_GROUPS).map(([group, groupKeys]) => h('section', { class: 'card' },
        h('h3', {}, tt.groups[group]),
        h('ul', { class: 'detail' }, groupKeys.map((key) => detailRow(model, day, progress.get(key), byKey.get(key)))))));
  }

  // MARK: - Targets tab

  function notices(state, today) {
    const { settings, reference } = state;
    const out = [h('p', { class: 'soft' }, tt.readOnlyTargets)];
    if (settings.newer.length) out.push(h('p', { class: 'notice' }, tt.newer(settings.newer.length)));
    if (settings.malformed.length) out.push(h('p', { class: 'notice' }, tt.malformed(settings.malformed.length)));
    if (reference.status === 'loading') out.push(h('p', { class: 'notice' }, tt.tableLoading));
    if (reference.status === 'error') {
      out.push(h('p', { class: 'notice' }, tt.tableError, ' ',
        h('button', { class: 'link', onclick: () => navigate({ retryReference: true }) }, tt.retry)));
    }
    if (MEDICAL_PRESETS.has(settings.watchList.preset)) out.push(h('p', { class: 'notice banner' }, tt.medical));
    if (state.model.targetsFor(today).status === 'unsupported') out.push(h('p', { class: 'notice' }, tt.unsupported));
    return out;
  }

  function weekSection(state, keys) {
    const weekKeys = [...new Set([...keys, ...WEEKLY_KEYS])];
    const summary = state.model.week(state.weekEnd, weekKeys);
    const shift = (days) => {
      const date = new Date(`${state.weekEnd}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      navigate({ weekEnd: date.toISOString().slice(0, 10) });
    };
    return h('section', { class: 'card', id: 'week' },
      h('div', { class: 'section-head' },
        h('h3', {}, `${tt.week} · ${tt.weekRange(formatDay(summary.from), formatDay(summary.to))}`),
        h('div', { class: 'actions' },
          h('button', { class: 'quiet small', 'aria-label': tt.previous, onclick: () => shift(-WEEK_DAYS) }, '←'),
          h('button', { class: 'quiet small', 'aria-label': tt.next, disabled: state.weekEnd >= state.today, onclick: () => shift(WEEK_DAYS) }, '→'))),
      h('p', { class: 'soft' }, tt.weekIntro),
      summary.daysLogged === 0
        ? h('p', { class: 'notice' }, tt.noDays)
        : h('ul', { class: 'detail' }, summary.rows.map((row) => h('li', { class: 'detail-row' },
          h('div', { class: 'detail-head' }, h('span', {}, name(row.nutrientKey)), h('span', { class: 'detail-total' }, amount(row.nutrientKey, row.unit, row.averageTotal))),
          h('p', { class: 'soft' }, [
            row.averagePercent === null ? null : tt.averagePercent(row.averagePercent),
            tt.weekDays(row.daysKnown, summary.daysLogged),
          ].filter(Boolean).join(' · '))))));
  }

  function chart(points, key, unit) {
    const salt = key === 'sodiumMg';
    const scale = (v) => (v === null ? null : salt ? saltFromSodium(v) : v);
    const values = points.map((p) => ({ ...p, total: scale(p.total), min: scale(p.min), max: scale(p.max) }));
    const top = Math.max(1, ...values.flatMap((p) => [p.total, p.min, p.max]).filter((v) => v !== null)) * 1.1;
    const barWidth = CHART.width / values.length;
    const y = (v) => CHART.height - (v / top) * CHART.height;
    const line = (field) => {
      let d = '';
      let previous = null;
      values.forEach((p, i) => {
        const v = p[field];
        if (v === null) { previous = null; return; }
        d += previous === null ? `M${i * barWidth} ${y(v)}` : v !== previous ? `V${y(v)}` : '';
        d += `H${(i + 1) * barWidth}`;
        previous = v;
      });
      return d ? svg('path', { class: 'target-line', d }) : null;
    };
    const hasRange = values.some((p) => p.max !== null && p.max !== p.min);
    const known = values.filter((p) => p.total !== null);
    const label = tt.trendLabel(name(key), values.length);
    return [
      svg('svg', { class: 'trend-chart', viewBox: `0 0 ${CHART.width} ${CHART.height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
        values.map((p, i) => (p.total === null ? null : svg('rect', {
          class: 'bar', x: i * barWidth + barWidth * 0.15, width: barWidth * 0.7, y: y(p.total), height: CHART.height - y(p.total),
        }, svg('title', {}, `${formatDay(p.date)}: ${number.format(p.total)} ${salt ? 'g' : unit}`)))),
        line('min'), hasRange ? line('max') : null),
      h('p', { class: 'soft chart-axis' },
        h('span', {}, formatDay(values[0].date)),
        values.some((p) => p.min !== null || p.max !== null) ? h('span', {}, `- - ${tt.targetLine}`) : null,
        h('span', {}, formatDay(values[values.length - 1].date))),
      known.length ? null : h('p', { class: 'notice' }, tt.trendEmpty),
    ];
  }

  function trendSection(state, keys) {
    const ordered = [...new Set([...keys, ...NUTRIENT_KEYS])];
    const select = h('select', {
      'aria-label': tt.trend,
      onchange: (event) => navigate({ trendKey: event.target.value }),
    }, ordered.map((key) => h('option', { value: key, selected: key === state.trendKey }, name(key))));
    const points = state.model.trend(state.today, state.trendLength, state.trendKey);
    const unit = state.model.progress(state.today, [state.trendKey])[0].unit;
    return h('section', { class: 'card', id: 'trend' },
      h('div', { class: 'section-head' },
        h('h3', {}, `${tt.trend} · ${tt.lastDays(state.trendLength)}`),
        select),
      h('nav', { class: 'tabs small' }, TREND_LENGTHS.map((n) => h('button', {
        'aria-current': n === state.trendLength ? 'page' : false, onclick: () => navigate({ trendLength: n }),
      }, tt.trendDays(n)))),
      chart(points, state.trendKey, unit));
  }

  function profileInputs(state, profile, day) {
    if (!profile) return [tt.noProfile];
    const level = ACTIVITY_LEVELS.find((l) => l.pal === profile.pal);
    const fromLog = weightForDay(state.settings.weights, day) !== null;
    const items = [
      tt.inputAge(profile.ageYears),
      profile.situation === 'none' ? tt.basis[profile.basis] : tt.basis.female,
      profile.situation === 'pregnant' ? tt.situation.pregnant(profile.trimester) : null,
      profile.situation === 'lactating' ? tt.situation.lactating(profile.lactation) : null,
      profile.postmenopausal ? tt.postmenopausal : null,
      `${tt.inputPal(number.format(profile.pal))}${level ? ` (${tt.levels[level.id]})` : ''}`,
      `${tt.inputWeight(number.format(profile.weightKg))}${fromLog ? ` (${tt.weightFromLog})` : ''}`,
      tt.phytate(profile.phytateMgPerDay ?? DEFAULT_PHYTATE),
    ];
    return items.filter(Boolean);
  }

  function explanationRow(target) {
    const kinds = target.overridden ? [tt.yours] : (target.valueKinds ?? []).map((kind) => tt.kinds[kind] ?? kind);
    if (target.upperLimit !== null) kinds.push(`${tt.kinds.ul} · ${tt.upperLevel(amount(target.nutrientKey, target.unit, target.upperLimit, false))}`);
    return h('li', { class: 'detail-row' },
      h('div', { class: 'detail-head' }, h('span', {}, name(target.nutrientKey, false)), h('span', { class: 'detail-total' }, targetText(target, false))),
      kinds.map((kind) => h('p', { class: 'soft' }, kind)),
      target.sources.length
        ? h('p', { class: 'soft sources' }, `${tt.sources}${lang === 'fr' ? ' : ' : ': '}`,
          target.sources.flatMap((link, i) => [i ? ' · ' : null, externalLink(link, link.replace(/^https:\/\//, ''))]))
        : null);
  }

  function explanation(state) {
    const day = state.explainDay;
    const targets = state.model.targetsFor(day);
    const order = (key) => NUTRIENT_KEYS.indexOf(key);
    const rows = targets.status === 'ok' ? [...targets.targets].sort((a, b) => order(a.nutrientKey) - order(b.nutrientKey)) : [];
    const levels = ACTIVITY_LEVELS.map((l) => `${tt.levels[l.id]} ${number.format(l.pal)}`).join(', ');
    const updated = state.settings.profileUpdatedAt;
    return h('section', { class: 'card', id: 'explain' },
      h('h3', {}, tt.explain),
      h('p', {}, tt.explainFor(formatDay(day))),
      targets.status === 'none' ? h('p', { class: 'notice' }, tt.nothingSet) : null,
      targets.status === 'unsupported' ? h('p', { class: 'notice' }, tt.unsupported) : null,
      targets.status === 'ok' || targets.status === 'unsupported'
        ? [h('h4', {}, tt.inputs), h('p', { class: 'soft' }, profileInputs(state, targets.profile, day).join(' · '))]
        : null,
      rows.length ? h('ul', { class: 'detail' }, rows.map(explanationRow)) : null,
      state.reference.status === 'ready'
        ? h('p', { class: 'soft' }, `${tt.tableSource}: `, externalLink(state.reference.sourceUrl, state.reference.source || state.reference.sourceUrl))
        : null,
      h('h4', {}, tt.ourChoices),
      h('ul', { class: 'choices' },
        [tt.choices.pal(levels), tt.choices.zinc(DEFAULT_PHYTATE), tt.choices.average, tt.choices.weight, tt.choices.salt]
          .map((text) => h('li', {}, text))),
      updated ? h('p', { class: 'soft' }, tt.updated(dateFormatter.format(new Date(updated * 1000)))) : null,
      h('p', { class: 'notice' }, tt.notAdvice));
  }

  function targetsTab(state) {
    const keys = state.settings.watchList.keys;
    return h('section', {}, notices(state, state.today), weekSection(state, keys), trendSection(state, keys), explanation(state));
  }

  return { dayRings, dayDetail, targetsTab };
}
