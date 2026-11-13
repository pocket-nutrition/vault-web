# Contributing to Pocket Nutrition Vault Web

Thanks for your interest in improving the viewer. It is a small static page with no backend, so the contribution
process is intentionally lightweight. It also handles a passphrase and decrypted health data in the browser, so a
few rules are strict: read "Invariants" below before you change anything that touches keys, requests or storage.

## Development setup

You need Node.js 22 (the version of the `node:22-alpine` build image in the [Dockerfile](Dockerfile), which CI
uses too) and npm.

```bash
git clone https://github.com/pocket-nutrition/vault-web.git
cd vault-web
./setup.sh                       # checks Node and npm, then runs npm ci
```

Or set up manually:

```bash
npm ci                           # installs exactly what package-lock.json pins
npm test
npm run build                    # writes dist/: one script, one stylesheet, one page
```

Use `npm install` only when you change a dependency, and commit the updated `package-lock.json` with it.

## Running tests

```bash
npm test                         # node --test "test/*.test.js"
node --test test/crypto.test.js  # one file
```

No test needs internet access. Two of them use a sibling checkout when there is one, next to this repository, and
are skipped without it (the Docker build has no siblings, so it skips them too):

- `test/integration.test.js` starts a real vault from `../vault`, a clone of
  [vault](https://github.com/pocket-nutrition/vault) with its virtualenv (in that clone:
  `python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`), builds an account the way the iOS
  app does and reads it back through this viewer's code.
- The last test of `test/vectors.test.js` compares `test/vectors/` byte for byte with `../contracts`, a clone of
  [contracts](https://github.com/pocket-nutrition/contracts).

| File | Covers |
|------|--------|
| `test/crypto.test.js` | Key derivation and record opening against the shared known answers, the KDF floor, tampering |
| `test/vault.test.js` | The vault client: no cookies, no referrer, no redirects, error kinds, paging, two-factor |
| `test/journal.test.js` | Reading decrypted meals and dictations, grouping by day, the CSV and its formula safety |
| `test/referenceIntakes.test.js` | The reference-table request and its parsing, and the pin on the CSP in `nginx.conf` |
| `test/targetRecords.test.js`, `test/dayTargets.test.js` | The daily-targets records and the view model |
| `test/vectors.test.js` | The shared daily-targets vector suites, run against `src/targets/` |
| `test/integration.test.js` | A real vault server read back through this viewer's code |

There is no linter, formatter or code coverage gate in this repository: keep changes consistent with the
surrounding style (ES modules, no framework, 2 spaces, semicolons, single quotes, English identifiers and
comments, a comment where the reason for a choice is not obvious).

## Trying the page against a local vault

Built as it is, the page talks only to the official vault and API, and those answer browsers from the official
page's origin only. To see your own build, run it against a vault on your machine:

1. In a clone of [vault](https://github.com/pocket-nutrition/vault), with its virtualenv set up as above, start it
   and allow the origin you will serve the page from:

   ```bash
   VAULT_CORS_ORIGINS=http://localhost:8080 .venv/bin/uvicorn app.main:build --factory --port 8000
   ```

2. Seed it with a demo account, a few meals, a dictation and daily targets. The script prints the username and the
   passphrase, and refuses any address on `pocketnutrition.org`:

   ```bash
   node scripts/dev-seed.mjs http://127.0.0.1:8000
   ```

3. Build the page against it and serve `dist/`:

   ```bash
   VAULT_URL=http://127.0.0.1:8000 npm run build
   python3 -m http.server 8080 --directory dist --bind 127.0.0.1
   ```

4. Open http://localhost:8080 and log in with the printed credentials.

The Targets tab needs the reference table of the API. Without `API_URL` the page asks the official API, which
refuses a local origin; set `API_URL=<url>` when you build to use a local or mock API that serves
`GET /reference-intakes` and allows your origin.

## Test-first expectations

For any change to `src/` that changes behavior, and above all to `src/crypto.js`, `src/vault.js`,
`src/referenceIntakes.js` and `nginx.conf`:

1. Add or update a test in `test/` that captures the behavior you are adding or fixing.
2. Confirm the test fails without your change and passes with it.
3. Run `npm test` and `npm run build` before opening a pull request. Both must pass.

Pull requests that change behavior without an accompanying test will be asked to add one.

## Invariants

Read the "Invariants" section of [CLAUDE.md](CLAUDE.md) before touching keys, requests, storage or the headers. In
short:

- Nothing readable leaves the browser. The passphrase, the keys and the decrypted journal stay in the memory of the
  page: no localStorage, sessionStorage, IndexedDB, cookies or URL state, and nothing is logged.
- No new network destination and no third-party script, font or style. The CSP in `nginx.conf` allows only the
  official vault and API, and `test/referenceIntakes.test.js` pins it: changing either needs a reason in the pull
  request.
- Build the DOM with `h()` from `src/dom.js` (text only). Never `innerHTML`, never inline script or style.
- The page is read-only: it never writes to the vault.
- Anything that cannot be opened or parsed is skipped, never shown half-trusted.
- No reference or nutrition values in the page: the targets come from the API at run time.
- `test/vectors/` is a copy from [contracts](https://github.com/pocket-nutrition/contracts) and
  `test/test-vectors.json` is the vault protocol's known answers, shared with the vault and the apps. Do not edit
  either here: change the source repository, then refresh the copy (and `test/vectors/CONTRACTS_VERSION`).

User-facing strings are in `src/i18n.js` and `src/targetStrings.js`, in English and French: add both. Every
JavaScript file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later`, and the stylesheet with
`/* SPDX-License-Identifier: AGPL-3.0-or-later */`.

## Branch and PR workflow

1. Fork the repository and create a feature branch off `main`.
2. Make focused commits with clear messages (e.g. `fix: handle a dictation with an empty transcript`).
3. Ensure `npm test` and `npm run build` pass locally.
4. Open a pull request against `main` and fill in the template: what changes and why, and which tests cover it.
5. Be responsive to review feedback. Small, focused PRs are easier to review and merge.

## Reporting issues

Please open a GitHub issue using the bug report template: what you did, what the page showed, your browser and
operating system, and whether you used the official page, the container image or a build from source.

Never paste your passphrase, a recovery code, a device key or the contents of your journal into an issue. If you
think you have found a security vulnerability, do not open an issue: follow [SECURITY.md](SECURITY.md).

## CI and releases

- Every pull request runs `.github/workflows/ci.yml`: the tests and the build on the Node version of the
  Dockerfile, and a check that the container image builds. The `ci-success` check must be green before a pull
  request can be merged, the branch must be up to date with `main`, and pull requests are squash-merged so history
  stays linear.
- If you contribute from a fork, the workflow waits for a maintainer to approve it. It runs with a
  read-only token and no secrets.
- Every commit merged to `main` is released automatically with a CalVer version, `vYYYY.M.N`: the year, the
  month, then a counter that restarts at 1 each month (for example `v2026.11.1`). You never pick a version
  number or edit a changelog; release notes are generated from the merged pull requests.
- A release publishes the container image `ghcr.io/pocket-nutrition/vault-web`.

## Licensing of contributions

The project is licensed under the GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`, see
[LICENSE](LICENSE)). By submitting a contribution you agree that it is licensed under the same terms. The files in
`test/vectors/` are the exception: they are copied unchanged from contracts and stay under the MPL-2.0.

## Using Claude Code

This repository includes a [CLAUDE.md](CLAUDE.md) with the commands, the layout and the invariants.

```bash
claude    # Start Claude Code in the repository root: it reads CLAUDE.md automatically
```
