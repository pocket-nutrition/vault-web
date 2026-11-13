// SPDX-License-Identifier: AGPL-3.0-or-later
// Ported from the sandbox's src/lib/dailyTargets.ts (MPL-2.0), the reference implementation.
// Keep the two in step: test/vectors.test.js runs the shared `daily-targets` suite against this file.
//
// Daily nutrient targets from the EFSA reference table served by GET /reference-intakes. The table comes
// from the API; this file only selects the rows that apply to one person and does the arithmetic
// (increments, per-kg protein, % of energy). It embeds no reference value: every number in the output
// traces back to a row of the input table.
//
// One addition over the reference: `targetDetails()` also says which EFSA value kind (PRI, AI, RI, AR) each
// target came from, for the explanation screen. `dailyTargets()` returns exactly the reference output.

import { roundHalfUp } from './rounding.js';

/**
 * @typedef {object} ReferenceRow One row of GET /reference-intakes, reduced to the fields the selection reads.
 * @property {string} nutrient
 * @property {string | null} nutrientKey
 * @property {string} population
 * @property {string} populationDescription
 * @property {number | null} ageFrom
 * @property {number | null} ageTo
 * @property {string | null} ageUnit
 * @property {number | null} pal
 * @property {boolean} isMale
 * @property {boolean} isFemale
 * @property {string} valueKind
 * @property {number | null} valueMin
 * @property {number | null} valueMax
 * @property {boolean} isIncrement
 * @property {string | null} unit
 * @property {string | null} sourceLink
 */

/**
 * @typedef {'female' | 'male' | 'average'} CalculationBasis
 * @typedef {object} TargetProfile
 * @property {number} ageYears
 * @property {CalculationBasis} basis
 * @property {'none' | 'pregnant' | 'lactating'} situation
 * @property {1 | 2 | 3} [trimester]
 * @property {'first-6-months' | 'after-6-months'} [lactation]
 * @property {boolean} [postmenopausal]
 * @property {number} pal
 * @property {number} weightKg
 * @property {number} [phytateMgPerDay]
 */

/**
 * @typedef {'kcal' | 'g' | 'mg' | 'µg'} TargetUnit
 * @typedef {object} NutrientTarget
 * @property {string} nutrientKey
 * @property {TargetUnit} unit
 * @property {number | null} min
 * @property {number | null} max
 * @property {number | null} upperLimit
 * @property {string[]} sources
 */

export const DEFAULT_PHYTATE = 600;
const ADULT_AGE = 18;
const ENERGY_KEY = 'energyKcal';

/** kcal per gram, for reference intakes given in % of energy (E%). */
const ENERGY_DENSITY = { carbohydratesG: 4, proteinG: 4, fatG: 9, saturatedFatG: 9 };

const TRIMESTER_LABEL = { 1: '1st trimester', 2: '2nd trimester', 3: '3rd trimester' };

const FIELDS = ['energy', 'goal', 'range', 'upperLimit'];

/** The value kinds that make a target. ar (except energy in kcal), ssi and anything else are not targets. */
function fieldOf(valueKind) {
  switch (valueKind) {
    case 'ar_kcal': return 'energy';
    case 'pri':
    case 'ai': return 'goal';
    case 'ri': return 'range';
    case 'ul': return 'upperLimit';
    default: return null;
  }
}

function unitOfKey(key) {
  if (key.endsWith('Kcal')) return 'kcal';
  if (key.endsWith('Ug')) return 'µg';
  if (key.endsWith('Mg')) return 'mg';
  if (key.endsWith('G')) return 'g';
  return null;
}

const MASS_IN_MG = { g: 1000, mg: 1, 'µg': 0.001 };

/** One EFSA amount in the journal unit of [key]; null for a unit that cannot be converted (row skipped). */
function toJournalUnit(amount, unit, key, weightKg, energyKcal) {
  const target = unitOfKey(key);
  if (target === null) return null;
  const u = unit.trim().replace('μ', 'µ');
  if (u === 'kcal/day') return target === 'kcal' ? amount : null;
  if (u === 'g/kg bw per day') return target === 'g' ? amount * weightKg : null;
  if (u === 'E%') {
    const density = ENERGY_DENSITY[key];
    if (density === undefined || energyKcal === null || target !== 'g') return null;
    return (energyKcal * amount) / (100 * density);
  }
  const match = /^(g|mg|µg)\/day$/.exec(u);
  if (!match || target === 'kcal') return null;
  return (amount * MASS_IN_MG[match[1]]) / MASS_IN_MG[target];
}

function inAgeBand(row, age) {
  if (row.ageUnit !== 'y' || row.ageFrom === null || row.ageTo === null) return false;
  return row.ageFrom <= age && age <= row.ageTo;
}

function matchesSex(row, basis) {
  return basis === 'male' ? row.isMale : row.isFemale;
}

const LPI_RE = /LPI\s*(\d+)\s*mg\/day/;

/**
 * Narrows the rows of one nutrient and one kind to the variant that applies: the activity level for
 * energy, the phytate level for zinc, menopause status for iron. A narrowing that would leave nothing is
 * not applied (EFSA has no postmenopausal value under 40, so an early menopause keeps the general value).
 */
function narrowVariants(rows, profile) {
  let out = rows.filter((r) => r.pal === null || r.pal === profile.pal);

  const phytate = profile.phytateMgPerDay ?? DEFAULT_PHYTATE;
  if (out.some((r) => LPI_RE.test(r.populationDescription))) {
    out = out.filter((r) => {
      const m = LPI_RE.exec(r.populationDescription);
      return m === null || Number(m[1]) === phytate;
    });
  }

  const post = out.filter((r) => r.populationDescription.includes('Postmenopausal'));
  if (profile.postmenopausal && post.length > 0) {
    out = post;
  } else {
    out = out.filter((r) => !r.populationDescription.includes('Postmenopausal'));
  }
  return out;
}

/** Matches a pregnancy or lactation row to the trimester or post-partum period, when the row names one. */
function matchesPeriod(row, profile) {
  const d = row.populationDescription;
  if (d.includes('trimester')) {
    return profile.trimester !== undefined && d.includes(TRIMESTER_LABEL[profile.trimester]);
  }
  if (d.includes('post partum')) {
    if (profile.lactation === undefined) return false;
    return profile.lactation === 'first-6-months' ? d.includes('0–6') || d.includes('0-6') : d.includes('>6');
  }
  return true;
}

const emptyRaw = () => ({
  energy: null, goal: null, rangeMin: null, rangeMax: null, upperLimit: null, sources: new Set(), kinds: {},
});

/** The first row of each target field for one nutrient key, in table order, after narrowing. */
function pickByField(rows, profile) {
  const picked = new Map();
  const byKind = new Map();
  for (const row of rows) {
    const list = byKind.get(row.valueKind) ?? [];
    list.push(row);
    byKind.set(row.valueKind, list);
  }
  // pri before ai: a PRI, when EFSA sets one, is the target; an AI is the fallback.
  for (const kind of ['ar_kcal', 'pri', 'ai', 'ri', 'ul']) {
    const field = fieldOf(kind);
    if (field === null || picked.has(field)) continue;
    const candidates = narrowVariants(byKind.get(kind) ?? [], profile).filter((r) => r.valueMin !== null);
    if (candidates.length > 0) picked.set(field, candidates[0]);
  }
  return picked;
}

function convert(row, key, profile, energyKcal) {
  if (row.unit === null || row.valueMin === null) return null;
  const min = toJournalUnit(row.valueMin, row.unit, key, profile.weightKg, energyKcal);
  const max = toJournalUnit(row.valueMax ?? row.valueMin, row.unit, key, profile.weightKg, energyKcal);
  return min === null || max === null ? null : { min, max };
}

/** Targets for one sex: base population, then the pregnancy or lactation rows on top. */
function targetsForSex(table, profile, sex) {
  const age = profile.ageYears;
  const basePopulation = age >= ADULT_AGE ? 'Adults' : 'Children';
  const situationPopulation =
    profile.situation === 'pregnant' ? 'Pregnant women' : profile.situation === 'lactating' ? 'Lactating women' : null;

  const rowsByKey = (population, extra) => {
    const out = new Map();
    for (const row of table) {
      if (row.nutrientKey === null || row.population !== population) continue;
      if (!inAgeBand(row, age) || !matchesSex(row, sex) || !extra(row)) continue;
      const list = out.get(row.nutrientKey) ?? [];
      list.push(row);
      out.set(row.nutrientKey, list);
    }
    return out;
  };

  const base = rowsByKey(basePopulation, () => true);
  const situation = situationPopulation === null ? new Map() : rowsByKey(situationPopulation, (r) => matchesPeriod(r, profile));

  // Energy first: % of energy intakes are converted with it.
  const ordered = [...new Set([...base.keys(), ...situation.keys()])].sort((a, b) =>
    a === ENERGY_KEY ? -1 : b === ENERGY_KEY ? 1 : a.localeCompare(b));

  const result = new Map();
  let energyKcal = null;

  for (const key of ordered) {
    const basePicked = pickByField(base.get(key) ?? [], profile);
    const situationPicked = pickByField(situation.get(key) ?? [], profile);
    const raw = emptyRaw();

    for (const field of FIELDS) {
      const baseRow = basePicked.get(field);
      const extraRow = situationPicked.get(field);
      let amount = baseRow ? convert(baseRow, key, profile, energyKcal) : null;
      let links = amount === null ? [] : [baseRow?.sourceLink ?? null];
      let kind = amount === null ? null : baseRow.valueKind;

      if (extraRow) {
        const extra = convert(extraRow, key, profile, energyKcal);
        if (extra !== null) {
          if (!extraRow.isIncrement) {
            amount = extra;
            links = [extraRow.sourceLink];
            kind = extraRow.valueKind;
          } else if (amount !== null) {
            amount = { min: amount.min + extra.min, max: amount.max + extra.max };
            links = [...links, extraRow.sourceLink];
          }
        }
      }
      if (amount === null) continue;
      for (const link of links) if (link) raw.sources.add(link);
      raw.kinds[field] = kind;

      if (field === 'energy') raw.energy = amount.min;
      if (field === 'goal') raw.goal = amount.min;
      if (field === 'range') { raw.rangeMin = amount.min; raw.rangeMax = amount.max; }
      if (field === 'upperLimit') raw.upperLimit = amount.min;
    }

    if (key === ENERGY_KEY) energyKcal = raw.energy;
    if (raw.energy !== null || raw.goal !== null || raw.rangeMin !== null || raw.upperLimit !== null) result.set(key, raw);
  }
  return result;
}

function roundFor(unit, value) {
  if (value === null) return null;
  return unit === 'kcal' || unit === 'g' ? roundHalfUp(value) : roundHalfUp(value * 10) / 10;
}

function toDetailedTarget(key, raw) {
  const unit = unitOfKey(key);
  if (unit === null) return null;
  let min = null;
  let max = null;
  let field = null;
  if (raw.energy !== null) { min = raw.energy; max = raw.energy; field = 'energy'; }
  else if (raw.rangeMin !== null) { min = raw.rangeMin; max = raw.rangeMax; field = 'range'; }
  else if (raw.goal !== null) { min = raw.goal; field = 'goal'; }
  return {
    nutrientKey: key,
    unit,
    min: roundFor(unit, min),
    max: roundFor(unit, max),
    upperLimit: roundFor(unit, raw.upperLimit),
    sources: [...raw.sources].sort(),
    valueKinds: field === null ? [] : [...new Set(raw.kinds[field] ?? [])].sort(),
  };
}

const mean = (a, b) => (a === null ? b : b === null ? a : (a + b) / 2);

function averageRaw(f, m) {
  const a = f ?? emptyRaw();
  const b = m ?? emptyRaw();
  const kinds = {};
  for (const field of FIELDS) {
    const both = [...(a.kinds[field] ?? []), ...(b.kinds[field] ?? [])];
    if (both.length) kinds[field] = both;
  }
  return {
    energy: mean(a.energy, b.energy),
    goal: mean(a.goal, b.goal),
    rangeMin: mean(a.rangeMin, b.rangeMin),
    rangeMax: mean(a.rangeMax, b.rangeMax),
    upperLimit: mean(a.upperLimit, b.upperLimit),
    sources: new Set([...a.sources, ...b.sources]),
    kinds,
  };
}

/** Wraps each kind in a list, so the average basis can carry both sexes' kinds. */
function listKinds(raws) {
  for (const raw of raws.values()) {
    for (const field of Object.keys(raw.kinds)) raw.kinds[field] = [raw.kinds[field]];
  }
  return raws;
}

/**
 * The targets of `dailyTargets()`, each with `valueKinds`: the EFSA value kinds its min/max came from
 * (`ar_kcal`, `pri`, `ai`, `ri`), empty for a target that only has an upper limit.
 */
export function targetDetails(table, profile) {
  if (profile.ageYears < 1) return { status: 'unsupported', reason: 'infant' };
  if (profile.ageYears < ADULT_AGE && profile.situation === 'pregnant') return { status: 'unsupported', reason: 'pregnancy-under-18' };
  if (profile.ageYears < ADULT_AGE && profile.situation === 'lactating') return { status: 'unsupported', reason: 'lactation-under-18' };

  const basis = profile.situation === 'none' ? profile.basis : 'female';
  let raws;
  if (basis === 'average') {
    const f = listKinds(targetsForSex(table, profile, 'female'));
    const m = listKinds(targetsForSex(table, profile, 'male'));
    raws = new Map([...new Set([...f.keys(), ...m.keys()])].map((k) => [k, averageRaw(f.get(k), m.get(k))]));
  } else {
    raws = listKinds(targetsForSex(table, profile, basis));
  }

  const targets = [...raws.entries()]
    .map(([key, raw]) => toDetailedTarget(key, raw))
    .filter((t) => t !== null)
    .sort((a, b) => a.nutrientKey.localeCompare(b.nutrientKey));
  return { status: 'ok', targets };
}

/**
 * The daily targets that apply to [profile], from the EFSA [table], exactly as the reference computes them.
 *
 * - Infants (under 1 year) and pregnancy or lactation under 18 are not supported.
 * - Pregnancy and lactation always compute with the female values, whatever the basis.
 * - The "average" basis averages the female and male results field by field, after each is complete.
 * @param {ReferenceRow[]} table
 * @param {TargetProfile} profile
 */
export function dailyTargets(table, profile) {
  const result = targetDetails(table, profile);
  if (result.status !== 'ok') return result;
  return { status: 'ok', targets: result.targets.map(({ valueKinds, ...target }) => target) };
}
