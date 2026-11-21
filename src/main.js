// SPDX-License-Identifier: AGPL-3.0-or-later

import sodium from 'libsodium-wrappers-sumo';

import { createCrypto, CryptoError, sameKdf } from './crypto.js';
import { createTargetModel } from './dayTargets.js';
import { h } from './dom.js';
import { LANGUAGES, pickLanguage, stringsFor } from './i18n.js';
import { dayKey, groupByDay, groupBySlot, readVault, toCsv } from './journal.js';
import { fetchReferenceTable, OFFICIAL_API } from './referenceIntakes.js';
import { targetStringsFor } from './targetStrings.js';
import { createTargetsView } from './targetsView.js';
import { createVaultClient, OFFICIAL_VAULT, VaultApiError } from './vault.js';

// Set at build time (see scripts/build.mjs): the official vault and API, or local ones when trying the page out.
/* global __VAULT_URL__, __API_URL__ */
const VAULT_URL = typeof __VAULT_URL__ === 'undefined' ? OFFICIAL_VAULT : __VAULT_URL__;
const API_URL = typeof __API_URL__ === 'undefined' ? OFFICIAL_API : __API_URL__;

// Everything the person typed or decrypted lives in this module's variables and nowhere else: no
// localStorage, no cookies, no URL. Closing the tab, logging out or a few idle minutes ends it.

const IDLE_MS = 10 * 60 * 1000;
const app = document.getElementById('app');
const vault = createVaultClient({ baseUrl: VAULT_URL });

/**
 * `targets` is null when the vault holds no daily-targets settings: the page then looks exactly as before
 * and fetches nothing from the API. The reference table, once fetched, lives in `targets.reference` only.
 * @type {{ apiKey: string, journal: { meals: any[], dictations: any[], targets: object }, tab: string, view: object | null,
 *          targets: object | null } | null}
 */
let session = null;
let idleTimer = null;
/** Draws the current view again, for a language change; set by each view. */
let redraw = () => {};

function render(...nodes) {
  app.replaceChildren(...nodes);
}

// MARK: - Language

// The browser's language first; the EN · FR switch changes it for this visit only (nothing is stored).
let lang;
let t;
let tt;
let dayFormatter;
let shortDayFormatter;
let timeFormatter;
let numberFormatter;
let targetsView;

const round = (value) => Math.round(value * 10) / 10;
const localDate = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
};

function setLanguage(next) {
  lang = LANGUAGES.includes(next) ? next : 'en';
  t = stringsFor(lang);
  tt = targetStringsFor(lang);
  dayFormatter = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  shortDayFormatter = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' });
  timeFormatter = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
  numberFormatter = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
  targetsView = createTargetsView({
    tt,
    lang,
    formatDay: (day) => shortDayFormatter.format(localDate(day)),
    formatTime: (seconds) => timeFormatter.format(new Date(seconds * 1000)),
    navigate,
  });
  document.documentElement.lang = lang;
  document.title = t.title;
  const siteName = document.getElementById('site-name');
  if (siteName) siteName.textContent = t.siteName;
  const switcher = document.getElementById('lang-switch');
  if (switcher) {
    switcher.setAttribute('aria-label', t.language);
    for (const button of switcher.querySelectorAll('button[data-lang]')) {
      button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
    }
  }
}

setLanguage(pickLanguage(navigator.languages));
for (const button of document.querySelectorAll('#lang-switch button[data-lang]')) {
  button.addEventListener('click', () => {
    if (button.dataset.lang === lang) return;
    setLanguage(button.dataset.lang);
    redraw();
  });
}

// MARK: - Login

function loginView(message = null, isError = true, typed = '') {
  const username = h('input', { id: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, value: typed || null });
  const passphrase = h('input', { id: 'passphrase', type: 'password', autocomplete: 'current-password', required: true });
  const button = h('button', { type: 'submit' }, t.login);
  const status = h('p', { class: message && isError ? 'notice error' : 'notice', hidden: !message, role: 'alert' }, message);

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      if (!username.value.trim() || !passphrase.value) {
        status.hidden = false;
        status.className = 'notice error';
        status.textContent = t.errUsername;
        return;
      }
      button.disabled = true;
      status.hidden = false;
      status.className = 'notice';
      status.textContent = t.working;
      // Let the message paint: key derivation is slow and runs on this thread.
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        await open(username.value.trim().toLowerCase(), passphrase.value);
      } catch (error) {
        passphrase.value = '';
        if (!session) loginView(describe(error));
      }
    },
  },
    h('label', {}, t.username, username),
    h('label', {}, t.passphrase, passphrase),
    button,
    status);

  // A message was written in the old language: a redraw drops it, and keeps the username typed so far.
  redraw = () => loginView(null, true, username.value);
  render(
    h('h1', {}, t.loginHeading),
    h('p', { class: 'soft' }, t.intro),
    h('div', { class: 'login' },
      h('div', { class: 'card' }, form),
      h('aside', { class: 'help' },
        h('h2', {}, t.newcomerTitle),
        h('p', {}, t.newcomer),
        h('p', {}, h('a', { class: 'button quiet', href: 'https://pocketnutrition.org/#apps' }, t.getApp)),
        h('p', {}, t.forgotten))));
  username.focus();
}

function describe(error) {
  if (error instanceof VaultApiError) {
    switch (error.kind) {
      case 'credentials': return t.errCredentials;
      case 'invalidTwoFactor': return t.errTwoFactor;
      case 'locked': return t.errLocked(error.retryAfter ? Math.max(1, Math.ceil(error.retryAfter / 60)) : null);
      case 'offline': return t.errOffline;
      case 'unauthorized': return t.errSession;
      default: return t.errServer;
    }
  }
  if (error instanceof CryptoError) return error.message === 'unacceptable kdf' ? t.errUnsafe : t.errUnreadable;
  return t.errServer;
}

// MARK: - Open and read

async function open(username, passphrase) {
  await sodium.ready;
  const crypto = createCrypto(sodium);
  const kdf = await vault.prelogin(username);
  const credentials = crypto.deriveCredentials(passphrase, kdf);
  const pending = { crypto, kdf, username, credentials };
  let reply;
  try {
    reply = await vault.login(username, credentials.authHash);
  } catch (error) {
    if (error instanceof VaultApiError && error.kind === 'twoFactorRequired') {
      twoFactorView(pending);
      return;
    }
    sodium.memzero(credentials.wrapKey);
    throw error;
  }
  await unlock(pending, reply);
}

/**
 * Two-factor login is on: the passphrase was right, the server now wants a code. The keys derived from the
 * passphrase are kept in memory for this one step so Argon2 does not run twice; cancelling wipes them.
 */
function twoFactorView(pending, message = null) {
  let useRecovery = false;
  const code = h('input', { id: 'code', autocomplete: 'one-time-code', inputmode: 'numeric', autocapitalize: 'none', spellcheck: 'false', required: true });
  const label = h('label', {}, t.twoFactorCode, code);
  const button = h('button', { type: 'submit' }, t.login);
  const status = h('p', { class: 'notice error', hidden: !message, role: 'alert' }, message);
  const toggle = h('button', { type: 'button', class: 'quiet' }, t.useRecoveryCode);
  toggle.onclick = () => {
    useRecovery = !useRecovery;
    label.firstChild.textContent = useRecovery ? t.recoveryCode : t.twoFactorCode;
    code.inputMode = useRecovery ? 'text' : 'numeric';
    toggle.textContent = useRecovery ? t.useTwoFactorCode : t.useRecoveryCode;
    code.value = '';
    code.focus();
  };
  const cancel = h('button', { type: 'button', class: 'quiet', onclick: () => {
    sodium.memzero(pending.credentials.wrapKey);
    loginView();
  } }, t.cancel);

  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      const value = code.value.replace(/\s+/g, '');
      if (!value) return;
      button.disabled = true;
      let reply;
      try {
        reply = await vault.login(pending.username, pending.credentials.authHash,
          useRecovery ? { recoveryCode: value } : { totpCode: value });
      } catch (error) {
        if (error instanceof VaultApiError && error.kind === 'invalidTwoFactor') {
          twoFactorView(pending, describe(error));
          return;
        }
        sodium.memzero(pending.credentials.wrapKey);
        loginView(describe(error));
        return;
      }
      try {
        await unlock(pending, reply);
      } catch (error) {
        loginView(describe(error));
      }
    },
  },
    h('p', { class: 'soft' }, t.twoFactorIntro),
    label,
    button,
    status,
    h('div', { class: 'actions' }, toggle, cancel));

  redraw = () => twoFactorView(pending);
  render(h('h1', {}, t.loginHeading), h('div', { class: 'card' }, form));
  code.focus();
}

async function unlock({ crypto, kdf, credentials }, reply) {
  redraw = () => render(h('h1', {}, t.loginHeading), h('p', { class: 'notice' }, t.loading));
  redraw();
  try {
    const { userKey, kdf: stored } = crypto.unwrapUserKey(reply.keyring.blob, credentials.wrapKey);
    // The keys came from the settings announced at prelogin: a keyring that claims others is the server
    // contradicting itself.
    if (!sameKdf(stored, kdf)) throw new CryptoError('unacceptable kdf');
    const records = await vault.readAll(reply.api_key);
    const journal = readVault(records, (record) => crypto.openRecord(reply.account_id, userKey, record));
    sodium.memzero(userKey);
    session = { apiKey: reply.api_key, journal, tab: 'journal', view: null, targets: targetState(journal) };
  } catch (error) {
    await vault.logout(reply.api_key);
    throw error;
  } finally {
    sodium.memzero(credentials.wrapKey);
  }
  armIdleTimer();
  journalView();
  loadReference();
}

// MARK: - Daily targets

const today = () => dayKey(Date.now() / 1000);

function targetState(journal) {
  const settings = journal.targets;
  if (settings.profiles.length === 0 && !settings.hasTargetsRecord) return null;
  const state = {
    settings,
    reference: { status: settings.profiles.length ? 'loading' : 'idle' },
    weekEnd: today(),
    explainDay: today(),
    trendKey: settings.watchList.keys[0] ?? 'energyKcal',
    trendLength: 30,
  };
  return { ...state, model: createTargetModel({ settings, table: null, meals: journal.meals }) };
}

/** Fetches the EFSA table when a profile needs it. Nothing personal is sent; the table stays in memory. */
async function loadReference() {
  const current = session;
  if (!current?.targets || current.targets.settings.profiles.length === 0) return;
  let reference;
  try {
    const table = await fetchReferenceTable({ baseUrl: API_URL });
    reference = { status: 'ready', ...table };
  } catch {
    reference = { status: 'error' };
  }
  if (session !== current) return; // logged out meanwhile: drop it
  const table = reference.status === 'ready' ? reference.rows : null;
  const { settings } = current.targets;
  current.targets = { ...current.targets, reference, model: createTargetModel({ settings, table, meals: current.journal.meals }) };
  journalView();
}

function navigate(change) {
  if (!session) return;
  if (change.retryReference) {
    session.targets = { ...session.targets, reference: { status: 'loading' } };
    journalView();
    loadReference();
    return;
  }
  const { view, tab, day, ...rest } = change;
  if (view === 'day') session.view = { kind: 'day', day };
  if (view === 'tab') {
    session.view = null;
    session.tab = tab;
  }
  session.targets = { ...session.targets, ...rest };
  journalView();
  const anchor = rest.explainDay ? 'explain' : rest.weekEnd && view === 'tab' ? 'week' : null;
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else if (view) window.scrollTo(0, 0);
}

// MARK: - Journal

function journalView() {
  if (!session) return loginView();
  redraw = journalView;
  const { journal, tab, targets } = session;
  const tabButton = (id, label) =>
    h('button', { 'aria-current': tab === id ? 'page' : false, onclick: () => navigate({ view: 'tab', tab: id }) }, label);
  const header = h('header', { class: 'bar' },
    h('h1', {}, t.journalHeading),
    h('div', { class: 'actions' },
      h('button', { class: 'quiet', onclick: () => download(toCsv(journal.meals)) }, t.export),
      h('button', { class: 'quiet', onclick: () => logout() }, t.logout)));

  if (targets && session.view?.kind === 'day') {
    render(header, targetsView.dayDetail(targets.model, session.view.day, targets.settings.watchList.keys));
    return;
  }
  let content;
  if (tab === 'targets' && targets) content = targetsView.targetsTab({ ...targets, today: today() });
  else if (tab === 'dictations') content = dictationsSection(journal.dictations);
  else content = mealsSection(journal.meals);
  render(
    header,
    h('p', { class: 'soft' }, t.readOnly, ' ', t.webDevice),
    h('nav', { class: 'tabs' },
      tabButton('journal', `${t.journal} (${journal.meals.length})`),
      tabButton('dictations', `${t.dictations} (${journal.dictations.length})`),
      targets ? tabButton('targets', tt.tab) : null),
    content);
}

/** A meal as the apps list it: its foods on one line, then the energy and the three macros. */
function mealRow(meal) {
  const grams = (value) => `${numberFormatter.format(round(value))} g`;
  const macro = (abbr, value) => h('span', { class: 'macro' }, `${abbr} ${grams(value)}`);
  return h('li', { class: 'meal' },
    h('div', { class: 'meal-head' },
      h('p', { class: 'meal-foods' }, meal.items.flatMap((item, i) => [
        i ? ' · ' : null, item.label, ' ', h('span', { class: 'grams' }, grams(item.grams))])),
      h('span', { class: 'meal-time' }, timeFormatter.format(new Date(meal.savedAt * 1000)))),
    h('p', { class: 'meal-totals' },
      h('span', { class: 'kcal' }, `${Math.round(meal.totals.kcal)} ${t.kcal}`),
      macro(t.proteinAbbr, meal.totals.protein), macro(t.carbsAbbr, meal.totals.carbs), macro(t.fatAbbr, meal.totals.fat)));
}

/** Each day is one card, like a section of the apps' journal: its rings, then its meals by slot. */
function mealsSection(meals) {
  if (!meals.length) return h('p', { class: 'notice' }, t.emptyJournal);
  const targets = session.targets;
  return h('section', { class: 'days' }, groupByDay(meals).map((day) => h('section', { class: 'day' },
    h('h2', { class: 'day-head' },
      h('span', { class: 'day-title' }, dayFormatter.format(localDate(day.day))),
      h('span', { class: 'day-total' }, `${t.meals(day.meals.length)} · ${Math.round(day.totals.kcal)} ${t.kcal}`)),
    h('div', { class: 'card day-card' },
      targets ? targetsView.dayRings(targets.model, day.day, targets.settings.watchList.keys) : null,
      groupBySlot(day.meals).flatMap((group) => [
        h('h3', { class: 'slot' }, t.slots[group.slot]),
        h('ul', { class: 'meals' }, group.meals.map(mealRow))])))));
}

function dictationsSection(dictations) {
  if (!dictations.length) return h('p', { class: 'notice' }, t.emptyDictations);
  return h('section', {}, dictations.map((dictation) => h('article', { class: 'card' },
    h('blockquote', {}, dictation.transcript),
    h('p', { class: 'soft' }, dictation.heard.join(' · ')))));
}

function download(csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = h('a', { href: url, download: 'pocket-nutrition-journal.csv' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// MARK: - End of session

async function logout(message = null) {
  const key = session?.apiKey;
  session = null;
  clearTimeout(idleTimer);
  if (key) await vault.logout(key);
  loginView(message, false);
}

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => logout(t.idle), IDLE_MS);
}
for (const type of ['pointerdown', 'keydown', 'scroll']) {
  document.addEventListener(type, () => { if (session) armIdleTimer(); }, { passive: true });
}

loginView();
