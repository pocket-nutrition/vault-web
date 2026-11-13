// SPDX-License-Identifier: AGPL-3.0-or-later

// The daily-targets records of the vault: `profile`, `targets` and `weight-YYYY-MM-DD`. This
// viewer only reads them. A record is taken whole or not at all: one malformed entry rejects the record,
// because a profile history with a hole would give the wrong targets for that period. A record written by
// a newer app version is reported, never guessed at.

import { NUTRIENT_KEY_SET, PRESETS, DEFAULT_PRESET } from './targets/nutrients.js';

export const READABLE_VERSION = 1;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BASES = new Set(['female', 'male', 'average']);
const SITUATIONS = new Set(['none', 'pregnant', 'lactating']);
const LACTATION = new Set(['first-6-months', 'after-6-months']);

const decoder = new TextDecoder();
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isPositive = (value) => isNumber(value) && value > 0;
const isDate = (value) => typeof value === 'string' && DATE_RE.test(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(plaintext) {
  try {
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    return null;
  }
}

/** `{ ok: payload }`, `{ newer: version }` or `{ malformed: true }`, from the envelope fields every type shares. */
function envelope(plaintext) {
  const payload = parseJson(plaintext);
  if (!isObject(payload) || !Number.isInteger(payload.version) || !isNumber(payload.updated_at)) return { malformed: true };
  if (payload.version > READABLE_VERSION) return { newer: payload.version };
  if (payload.version !== READABLE_VERSION) return { malformed: true };
  return { ok: payload };
}

/** One profile version in the reference's camelCase shape, or null. Optional fields are absent when null. */
function parseProfileVersion(raw) {
  if (!isObject(raw) || !isDate(raw.effective_from) || !Number.isInteger(raw.birth_year)) return null;
  if (!BASES.has(raw.basis) || !SITUATIONS.has(raw.situation) || !isPositive(raw.pal) || !isPositive(raw.weight_kg)) return null;
  const version = {
    effectiveFrom: raw.effective_from, birthYear: raw.birth_year, basis: raw.basis, situation: raw.situation,
    pal: raw.pal, weightKg: raw.weight_kg,
  };
  if (raw.trimester != null) {
    if (![1, 2, 3].includes(raw.trimester)) return null;
    version.trimester = raw.trimester;
  }
  if (raw.lactation != null) {
    if (!LACTATION.has(raw.lactation)) return null;
    version.lactation = raw.lactation;
  }
  if (raw.postmenopausal != null) {
    if (typeof raw.postmenopausal !== 'boolean') return null;
    version.postmenopausal = raw.postmenopausal;
  }
  if (raw.phytate_mg_per_day != null) {
    if (!isPositive(raw.phytate_mg_per_day)) return null;
    version.phytateMgPerDay = raw.phytate_mg_per_day;
  }
  return version;
}

/** `{ updatedAt, versions }` from a `profile` record, or an `{ newer }` / `{ malformed }` marker. */
export function parseProfileRecord(plaintext) {
  const env = envelope(plaintext);
  if (!env.ok) return env;
  if (!Array.isArray(env.ok.versions)) return { malformed: true };
  const versions = env.ok.versions.map(parseProfileVersion);
  if (versions.includes(null)) return { malformed: true };
  return { ok: { updatedAt: env.ok.updated_at, versions } };
}

const isBound = (value) => value === null || isNumber(value);

function parseOverrideVersion(raw) {
  if (!isObject(raw) || !isDate(raw.effective_from) || !isObject(raw.values)) return null;
  const values = {};
  for (const [key, bounds] of Object.entries(raw.values)) {
    if (!NUTRIENT_KEY_SET.has(key)) continue; // a key this viewer does not know: nothing to show it against
    if (!isObject(bounds) || !isBound(bounds.min ?? null) || !isBound(bounds.max ?? null)) return null;
    values[key] = { min: bounds.min ?? null, max: bounds.max ?? null };
  }
  return { effectiveFrom: raw.effective_from, values };
}

function parseWatchList(raw) {
  if (!isObject(raw)) return { preset: DEFAULT_PRESET, keys: PRESETS[DEFAULT_PRESET] };
  const preset = typeof raw.preset === 'string' ? raw.preset : 'custom';
  const listed = Array.isArray(raw.keys) ? raw.keys : PRESETS[preset] ?? [];
  const keys = [...new Set(listed.filter((key) => NUTRIENT_KEY_SET.has(key)))];
  return { preset, keys };
}

/** `{ updatedAt, overrides, watchList }` from a `targets` record, or an `{ newer }` / `{ malformed }` marker. */
export function parseTargetsRecord(plaintext) {
  const env = envelope(plaintext);
  if (!env.ok) return env;
  const rawOverrides = env.ok.overrides ?? [];
  if (!Array.isArray(rawOverrides)) return { malformed: true };
  const overrides = rawOverrides.map(parseOverrideVersion);
  if (overrides.includes(null)) return { malformed: true };
  return { ok: { updatedAt: env.ok.updated_at, overrides, watchList: parseWatchList(env.ok.watch_list) } };
}

/** `{ date, kg }` from a `weight-YYYY-MM-DD` record whose date matches its id. */
export function parseWeightRecord(plaintext, recordId) {
  const env = envelope(plaintext);
  if (!env.ok) return env;
  const { date, kg } = env.ok;
  if (!isDate(date) || recordId !== `weight-${date}` || !isPositive(kg)) return { malformed: true };
  return { ok: { date, kg } };
}

export const TARGET_RECORD_TYPES = new Set(['profile', 'targets', 'weight']);

/** An empty settings set: no profile, no override, the default watch list. */
export function emptyTargetSettings() {
  return {
    profiles: [], profileUpdatedAt: null, overrides: [], watchList: parseWatchList(null), hasTargetsRecord: false,
    weights: [], newer: [], malformed: [],
  };
}

/**
 * Folds one opened target record into [settings], returning a new settings object. Records with the wrong
 * id for their type are treated as malformed.
 */
export function addTargetRecord(settings, record, plaintext) {
  const note = (list, entry) => ({ ...settings, [list]: [...settings[list], entry] });
  let parsed;
  if (record.type === 'profile') parsed = record.id === 'profile' ? parseProfileRecord(plaintext) : { malformed: true };
  else if (record.type === 'targets') parsed = record.id === 'targets' ? parseTargetsRecord(plaintext) : { malformed: true };
  else if (record.type === 'weight') parsed = parseWeightRecord(plaintext, record.id);
  else return settings;

  if (parsed.newer !== undefined) return note('newer', { type: record.type, id: record.id, version: parsed.newer });
  if (!parsed.ok) return note('malformed', { type: record.type, id: record.id });
  if (record.type === 'profile') return { ...settings, profiles: parsed.ok.versions, profileUpdatedAt: parsed.ok.updatedAt };
  if (record.type === 'targets') {
    return { ...settings, overrides: parsed.ok.overrides, watchList: parsed.ok.watchList, hasTargetsRecord: true };
  }
  return { ...settings, weights: [...settings.weights, parsed.ok] };
}
