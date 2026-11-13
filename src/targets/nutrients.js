// SPDX-License-Identifier: AGPL-3.0-or-later

// Nutrient keys and the watch-list presets. Keys only: no value of any kind lives here.

/** The 24 nutrient fields of NutritionalProfileResponse, in the schema's order (NutrientTotals.keys). */
export const NUTRIENT_KEYS = [
  'energyKcal', 'proteinG', 'fatG', 'carbohydratesG', 'fiberG', 'waterG', 'sugarsG',
  'calciumMg', 'ironMg', 'magnesiumMg', 'sodiumMg', 'vitaminCMg', 'saturatedFatG',
  'monounsaturatedFatG', 'polyunsaturatedFatG', 'cholesterolMg', 'potassiumMg', 'phosphorusMg',
  'zincMg', 'vitaminAUg', 'vitaminDUg', 'vitaminB6Mg', 'vitaminB12Ug', 'niacinMg',
];
export const NUTRIENT_KEY_SET = new Set(NUTRIENT_KEYS);

export const PRESETS = {
  standard: ['energyKcal', 'proteinG', 'carbohydratesG', 'fatG', 'fiberG', 'sugarsG'],
  sport: ['energyKcal', 'proteinG', 'carbohydratesG', 'fatG', 'fiberG', 'waterG'],
  kidney: ['energyKcal', 'proteinG', 'potassiumMg', 'phosphorusMg', 'sodiumMg'],
  hypertension: ['energyKcal', 'sodiumMg', 'potassiumMg', 'saturatedFatG', 'fiberG'],
  diabetes: ['energyKcal', 'carbohydratesG', 'sugarsG', 'fiberG', 'saturatedFatG'],
  everything: NUTRIENT_KEYS,
};
export const DEFAULT_PRESET = 'standard';
export const MEDICAL_PRESETS = new Set(['kidney', 'hypertension', 'diabetes']);

/** Day-detail groups, covering every key once. */
export const NUTRIENT_GROUPS = {
  macros: ['energyKcal', 'proteinG', 'carbohydratesG', 'sugarsG', 'fiberG', 'fatG', 'waterG'],
  fats: ['saturatedFatG', 'monounsaturatedFatG', 'polyunsaturatedFatG', 'cholesterolMg'],
  minerals: ['calciumMg', 'ironMg', 'magnesiumMg', 'sodiumMg', 'potassiumMg', 'phosphorusMg', 'zincMg'],
  vitamins: ['vitaminAUg', 'vitaminB6Mg', 'vitaminB12Ug', 'vitaminCMg', 'vitaminDUg', 'niacinMg'],
};

/** Nutrients that read better over a week than a day; the day detail links them to the week view. */
export const WEEKLY_KEYS = new Set(['vitaminDUg', 'vitaminB12Ug']);

/** EFSA's activity levels: one of "our choices", shown on the explanation. */
export const ACTIVITY_LEVELS = [
  { id: 'sedentary', pal: 1.4 },
  { id: 'moderate', pal: 1.6 },
  { id: 'active', pal: 1.8 },
  { id: 'veryActive', pal: 2.0 },
];

/** Salt is shown from sodium: salt (g) = sodium (mg) x 2.5 / 1000. Display arithmetic only. */
export const SALT_PER_SODIUM_MG = 2.5 / 1000;
