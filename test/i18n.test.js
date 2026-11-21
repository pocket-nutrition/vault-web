// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LANGUAGES, pickLanguage, STRING_TABLES, stringsFor } from '../src/i18n.js';
import { TARGET_STRING_TABLES, targetStringsFor } from '../src/targetStrings.js';

test('the browser language picks French for any French locale, English otherwise', () => {
  assert.equal(pickLanguage(['fr-CA', 'en']), 'fr');
  assert.equal(pickLanguage(['de', 'FR']), 'fr');
  assert.equal(pickLanguage(['en-GB']), 'en');
  assert.equal(pickLanguage([]), 'en');
  assert.equal(pickLanguage(undefined), 'en');
});

test('the switch offers exactly the languages there are strings for', () => {
  assert.deepEqual([...LANGUAGES].sort(), Object.keys(STRING_TABLES).sort());
  assert.deepEqual([...LANGUAGES].sort(), Object.keys(TARGET_STRING_TABLES).sort());
});

test('a language chosen on the page gives its strings, and an unknown one falls back to English', () => {
  assert.equal(stringsFor('fr'), STRING_TABLES.fr);
  assert.equal(stringsFor('en'), STRING_TABLES.en);
  assert.equal(stringsFor('xx'), STRING_TABLES.en);
  assert.equal(targetStringsFor('fr'), TARGET_STRING_TABLES.fr);
  assert.equal(targetStringsFor('xx'), TARGET_STRING_TABLES.en);
});

test('English and French name the same things', () => {
  assert.deepEqual(Object.keys(STRING_TABLES.fr).sort(), Object.keys(STRING_TABLES.en).sort());
  for (const [key, value] of Object.entries(STRING_TABLES.en)) {
    assert.equal(typeof STRING_TABLES.fr[key], typeof value, key);
  }
});
