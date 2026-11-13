// SPDX-License-Identifier: AGPL-3.0-or-later

// The shared daily-targets vector suites, run against this viewer's port of the sandbox reference.
// test/vectors/ is a copy of vectors/ from https://github.com/pocket-nutrition/contracts at the version in
// CONTRACTS_VERSION, so the Docker build (which has no sibling checkout) runs them too. When a sibling
// `contracts` checkout is present, the copy must match it byte for byte.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { dailyTargets } from '../src/targets/dailyTargets.js';
import { dayProgress, selfComparison } from '../src/targets/dayProgress.js';
import { roundHalfUp } from '../src/targets/rounding.js';
import { applyOverrides, profileForDay, weightForDay } from '../src/targets/targetHistory.js';

const here = new URL('./vectors/', import.meta.url);
const sibling = new URL('../../contracts/', import.meta.url);

const SUITES = {
  'daily-targets': ({ table, profile }) => dailyTargets(table, profile),
  'weight-for-day': ({ entries, day }) => weightForDay(entries, day),
  'profile-for-day': ({ versions, weights, day }) => profileForDay(versions, weights, day),
  'apply-target-overrides': ({ targets, versions, day }) => applyOverrides(targets, versions, day),
  'day-progress': ({ targets, meals, keys }) => dayProgress(targets, meals, keys),
  'self-comparison': ({ history, day, total }) => selfComparison(history, day, total),
};

const load = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, here), 'utf8'));

for (const [name, run] of Object.entries(SUITES)) {
  const suite = load(name);
  test(`vector suite ${name}: ${suite.cases.length} cases`, async (t) => {
    assert.equal(suite.suite, name);
    assert.ok(suite.cases.length > 0);
    for (const vector of suite.cases) {
      await t.test(vector.id, () => assert.deepEqual(run(vector.input), vector.expected, vector.why));
    }
  });
}

test('half-up rounding matches the platform rule on ties', () => {
  assert.equal(roundHalfUp(12.5), 13);
  assert.equal(roundHalfUp(-0.5), 0);
  assert.equal(roundHalfUp(2.4999), 2);
});

test('the vendored vectors match the sibling contracts checkout when there is one', { skip: !existsSync(new URL('vectors/', sibling)) }, () => {
  assert.equal(readFileSync(new URL('CONTRACTS_VERSION', here), 'utf8').trim(), readFileSync(new URL('VERSION', sibling), 'utf8').trim());
  for (const name of Object.keys(SUITES)) {
    assert.equal(readFileSync(new URL(`${name}.json`, here), 'utf8'), readFileSync(new URL(`vectors/${name}.json`, sibling), 'utf8'), name);
  }
});
