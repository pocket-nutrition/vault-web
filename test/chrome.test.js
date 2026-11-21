// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The header and footer are static markup shared with the website and the Food Dataset. The CSP allows
// no inline script or style, so the page must carry none, and the language switch only works through app.js.
const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('the page carries no inline script, inline style or event attribute', () => {
  assert.doesNotMatch(page, /<script(?![^>]*\ssrc=)[^>]*>/i);
  assert.doesNotMatch(page, /<style|\sstyle=/i);
  assert.doesNotMatch(page, /\son[a-z]+=/i);
});

test('the group bar lists the group sites, with the journal as the current one', () => {
  const bar = page.match(/<nav class="group-bar"[\s\S]*?<\/nav>/)[0];
  const labels = [...bar.matchAll(/class="group-bar-link"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(labels, ['Website', 'Food Dataset', 'Docs', 'My journal', 'API', 'Star on GitHub']);
  assert.match(bar, /href="\/"[^>]*aria-current="true"[^>]*>My journal/);
});

test('every link leaves through https or stays on this page', () => {
  for (const [, href] of page.matchAll(/href="([^"]*)"/g)) {
    assert.ok(href === '/' || href === 'style.css' || href === 'data:,' || href.startsWith('https://'), href);
  }
});

test('the language switch offers both languages as buttons, not links', () => {
  const buttons = [...page.matchAll(/<button[^>]*data-lang="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons, ['en', 'fr']);
});
