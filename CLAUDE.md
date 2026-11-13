# CLAUDE.md

**Port:** 80 (nginx container) | **Stack:** JavaScript (ES modules), esbuild, libsodium (WebAssembly), nginx | **Image:** `ghcr.io/pocket-nutrition/vault-web`

Read-only web viewer for a Pocket Nutrition vault (`me.pocketnutrition.org`). Static page, no backend.

## Invariants

- **Nothing readable ever reaches a server.** The passphrase and every key live in this page's memory only:
  no localStorage, cookies, URL state or third-party script. Keep it that way. `src/` has no `console` call either:
  nothing the person typed or decrypted is logged.
- Protocol: `docs/PROTOCOL.md` in [vault](https://github.com/pocket-nutrition/vault). Crypto in `src/crypto.js` is
  checked against the shared `test/test-vectors.json` (same file as the iOS app and the server).
- The `meal` record format is `MealRecordPayload` v1/v2 from the iOS app (`Sources/PocketNutritionCore/MealRecord.swift`
  in [ios](https://github.com/pocket-nutrition/ios)). Readers ignore unknown fields and skip anything they cannot open
  or parse; never show half-trusted data.
- Daily targets: `profile`, `targets` and `weight-*` records are read in `src/targetRecords.js`, never written. The
  numbers come only from `GET /reference-intakes` of the [API](https://github.com/pocket-nutrition/api) (no parameter,
  kept in memory); no reference value is embedded. The maths in `src/targets/` is ported from the sandbox's reference
  implementation (`src/lib/`) and must keep passing `test/vectors/` (refresh that copy from `vectors/` in
  [contracts](https://github.com/pocket-nutrition/contracts) when the contract moves; a test compares them when a
  sibling `contracts` checkout exists). Rounding is half-up (`roundHalfUp`), and rings are never red.
- Build the DOM with `textContent` only (see `h()` in `src/dom.js`); the CSP in `nginx.conf` forbids inline
  script and style, and any host but the official vault and API (`test/referenceIntakes.test.js` pins it).
  Changing either needs a reason.
- Read-only on purpose: writing meals from a browser needs conflict handling the app owns.

## Commands

```bash
./setup.sh                              # first-time setup: checks Node 22+, then npm ci
npm test                                # node --test "test/*.test.js"; one file: node --test test/crypto.test.js
npm run build                           # dist/: app.js (esbuild bundle), index.html, style.css
docker build -t vault-web .             # runs npm ci, npm test and npm run build; no secrets, no build args
docker run --rm -p 8080:80 vault-web    # nginx with the headers of nginx.conf: http://localhost:8080
```

Two tests use a sibling checkout when there is one and are skipped without it (the Docker build has none):
`test/integration.test.js` starts `../vault` (a clone of [vault](https://github.com/pocket-nutrition/vault) with
its `.venv`) and `test/vectors.test.js` compares `test/vectors/` with `../contracts`.

To try the page: run a local vault with `VAULT_CORS_ORIGINS` set to the origin you serve from, seed it with
`node scripts/dev-seed.mjs <local url>`, then `VAULT_URL=<local url> npm run build` (add `API_URL=<url>` to fetch
the reference table from a local or mock API) and serve `dist/`, for instance
`python3 -m http.server 8080 --directory dist --bind 127.0.0.1`. Steps in [CONTRIBUTING.md](CONTRIBUTING.md).

## Layout

```
src/main.js        UI flow: login, two-factor, unlock, journal and targets tabs, CSV export, logout, idle timer (10 min)
src/vault.js       vault client: prelogin, login, read every record, logout (no cookies, no referrer, no redirects)
src/crypto.js      Argon2id credentials, keyring unwrap, XChaCha20-Poly1305 record opening, floor on KDF settings
src/journal.js     parses decrypted meals and dictations, groups by day, formula-safe CSV
src/referenceIntakes.js   GET /reference-intakes (EFSA table) from the API, validated row by row
src/targetRecords.js, dayTargets.js, targetsView.js   targets records (read only), view model (pure), views
src/targets/       port of the sandbox's calculation; nutrients.js holds keys only, no reference value
src/dom.js, i18n.js, targetStrings.js   h() and svg() helpers; English and French strings
public/            index.html and style.css, copied to dist/
scripts/           build.mjs (esbuild, one IIFE script); dev-seed.mjs (dev only: demo account in a LOCAL vault)
test/              node:test suites; test/vectors/ is copied from contracts (CONTRACTS_VERSION)
nginx.conf         CSP and security headers; the Dockerfile builds (tests included), then serves with nginx
```

Flow: prelogin (KDF settings), Argon2id in the browser, login with the derived hash, unwrap the user key from the
keyring, read every record (`GET /v1/sync`), open and parse in memory. When the vault holds daily-targets settings,
the page then fetches the EFSA table from the API and computes the targets locally.

## Configuration

No `.env` and no runtime setting. Two optional build-time variables, only for trying the page against a local vault
or API (served by the image, the CSP still blocks any other host):

| Variable | Description |
|----------|-------------|
| `VAULT_URL` | Replaces the official vault address compiled into `dist/app.js` |
| `API_URL` | Replaces the official API address compiled into `dist/app.js` |

## Conventions

- No framework, no linter or formatter config: follow the surrounding style (2 spaces, semicolons, single quotes).
- Line 1 of every JavaScript file is `// SPDX-License-Identifier: AGPL-3.0-or-later` (`/* ... */` in the CSS). The project
  is AGPL-3.0-or-later; `test/vectors/` stays MPL-2.0 and is never edited here.
- UI strings live in `src/i18n.js` and `src/targetStrings.js`, in English and French: add both.
- Code, comments, commit messages and docs are in English. A change in behavior comes with a test.
- Releases are CalVer (`vYYYY.M.N`), cut by CI on every merge to `main`; the `version` in `package.json` is not it.

## Docs and contributing

[Architecture overview](https://website.pocketnutrition.org/docs/architecture/overview) ·
[CONTRIBUTING.md](CONTRIBUTING.md) for the PR workflow and CI · vulnerabilities are reported privately, see
[SECURITY.md](SECURITY.md).
