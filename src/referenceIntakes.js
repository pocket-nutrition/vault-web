// SPDX-License-Identifier: AGPL-3.0-or-later

// GET /reference-intakes: EFSA's full reference table, the same for everyone. The request carries no
// parameter, no credential, no cookie and no referrer, so nothing about the person reaches the API. The
// table is kept in the session's memory only and dropped at logout, like everything else on this page.

export const OFFICIAL_API = 'https://api.pocketnutrition.org';

export class ReferenceIntakesError extends Error {}

const isNumberOrNull = (value) => value === null || (typeof value === 'number' && Number.isFinite(value));
const isStringOrNull = (value) => value === null || typeof value === 'string';

/** One row reduced to the fields the calculation reads, or null when its shape is wrong. */
export function parseReferenceRow(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const row = {
    nutrient: raw.nutrient,
    nutrientKey: raw.nutrientKey ?? null,
    population: raw.population,
    populationDescription: raw.populationDescription ?? '',
    ageFrom: raw.ageFrom ?? null,
    ageTo: raw.ageTo ?? null,
    ageUnit: raw.ageUnit ?? null,
    pal: raw.pal ?? null,
    isMale: raw.isMale,
    isFemale: raw.isFemale,
    valueKind: raw.valueKind,
    valueMin: raw.valueMin ?? null,
    valueMax: raw.valueMax ?? null,
    isIncrement: raw.isIncrement ?? false,
    unit: raw.unit ?? null,
    sourceLink: raw.sourceLink ?? null,
  };
  const valid =
    typeof row.nutrient === 'string' && isStringOrNull(row.nutrientKey) && typeof row.population === 'string' &&
    typeof row.populationDescription === 'string' && isNumberOrNull(row.ageFrom) && isNumberOrNull(row.ageTo) &&
    isStringOrNull(row.ageUnit) && isNumberOrNull(row.pal) && typeof row.isMale === 'boolean' &&
    typeof row.isFemale === 'boolean' && typeof row.valueKind === 'string' && isNumberOrNull(row.valueMin) &&
    isNumberOrNull(row.valueMax) && typeof row.isIncrement === 'boolean' && isStringOrNull(row.unit) &&
    isStringOrNull(row.sourceLink);
  return valid ? row : null;
}

/** `{ source, sourceUrl, rows }`. Rows of the wrong shape are dropped; an empty table is an error. */
export function parseReferenceTable(body) {
  if (body === null || typeof body !== 'object' || !Array.isArray(body.values)) throw new ReferenceIntakesError('malformed');
  const rows = body.values.map(parseReferenceRow).filter((row) => row !== null);
  if (rows.length === 0) throw new ReferenceIntakesError('empty');
  return {
    source: typeof body.source === 'string' ? body.source : '',
    sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : '',
    rows,
  };
}

export async function fetchReferenceTable({ baseUrl = OFFICIAL_API, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/reference-intakes`, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error',
      cache: 'no-store', referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ReferenceIntakesError('offline');
  }
  if (!response.ok) throw new ReferenceIntakesError('server');
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ReferenceIntakesError('malformed');
  }
  return parseReferenceTable(body);
}
