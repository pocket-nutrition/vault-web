# Pocket Nutrition — Vault Web

A read-only web viewer for your [Pocket Nutrition](https://pocketnutrition.org) vault: it decrypts your
journal in your browser, never on a server. The official page is
[me.pocketnutrition.org](https://me.pocketnutrition.org).

Log in with your username and passphrase to see your journal and dictations and to export the journal as CSV.

## What it shows

- **Journal:** your meals, newest day first, with each day's totals, and an export of the journal as CSV (one row
  per ingredient).
- **Dictations:** what you said to the app and the foods it heard.
- **Daily targets**, when the app has them set up, read-only: rings on each day, a day detail, the week, a trend
  for one nutrient and how each target is calculated.
- Two-factor login (authenticator code or recovery code) when the account has it, and English or French
  according to the browser's language.

## How your data is protected

Your data is end-to-end encrypted. This page derives your keys and decrypts **in your browser**: the
passphrase never leaves the tab, and the server only ever holds ciphertext it cannot read. Nothing is stored
in the browser, and the session ends when you log out, close the tab, or stay idle for 10 minutes.

- A strict Content Security Policy ([nginx.conf](nginx.conf)) allows scripts from the page itself only (plus
  WebAssembly, which libsodium needs to run Argon2id), no inline script or style, and network requests only to the
  official vault and the official API.
- Requests carry no cookies and no referrer, and a redirect is an error, so a login hash or a device key never
  follows a response somewhere else.
- The DOM is built from text only (`h()` in `src/dom.js`): nothing that comes from the vault or the API is parsed
  as HTML.
- The one request to the API fetches the EFSA reference table the targets are computed from. It carries no
  parameter, credential, cookie or referrer, so nothing about you reaches the API; the table is kept in memory for
  the session and computed against in the browser.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Prerequisites

- Node.js 22 and npm (the version of the `node:22-alpine` image in the [Dockerfile](Dockerfile), which CI uses too)
- Docker, to build or run the container image (optional)
- Python 3.12 and a clone of [vault](https://github.com/pocket-nutrition/vault), only to run the integration test or
  to try the page against a local vault (optional)

## Quick start

```bash
git clone https://github.com/pocket-nutrition/vault-web.git
cd vault-web
./setup.sh          # checks Node and npm, then runs npm ci
npm test            # unit tests, plus an integration test when ../vault is there (see Testing)
npm run build       # dist/: one script, one stylesheet, one page
```

The page talks to the official vault and API, which allow browsers from the official page's origin only. To see your
own build, run it against a local vault: see "Trying the page against a local vault" in
[CONTRIBUTING.md](CONTRIBUTING.md).

## Running with Docker

```bash
docker build -t vault-web .             # runs npm ci, npm test and npm run build; needs no secrets
docker run --rm -p 8080:80 vault-web    # http://localhost:8080
```

Every release publishes the image `ghcr.io/pocket-nutrition/vault-web`, tagged `latest` and with its CalVer version
(for example `2026.11.1`):

```bash
docker run --rm -p 8080:80 ghcr.io/pocket-nutrition/vault-web
```

This is how the official page is hosted: nginx serves the built page on port 80 with the headers of `nginx.conf`
(strict CSP, no referrer, nothing cached). It speaks plain HTTP, so run it behind a TLS-terminating proxy. The
[vault](https://github.com/pocket-nutrition/vault) must list the origin the page is served from in
`VAULT_CORS_ORIGINS`, and the [API](https://github.com/pocket-nutrition/api) must allow it in CORS for
`GET /reference-intakes`: the EFSA table the targets are computed from.

## Using another vault

The addresses of the vault and of the API are fixed for the official deployment: `OFFICIAL_VAULT` in
`src/vault.js`, `OFFICIAL_API` in `src/referenceIntakes.js`, the `connect-src` of the CSP in `nginx.conf` and the
test that pins that CSP (`test/referenceIntakes.test.js`). A self-hosted vault therefore needs those changed. For a
quick trial, `VAULT_URL` and `API_URL` replace the two addresses when you run `npm run build` (see
[CONTRIBUTING.md](CONTRIBUTING.md)), but the CSP of the image still blocks any other host. Configurable addresses
are planned.

## Testing

```bash
npm test                          # node --test "test/*.test.js"
node --test test/crypto.test.js   # one file
```

Two tests are skipped unless a sibling checkout sits next to this repository:

- `test/integration.test.js` starts a real vault from `../vault` (a clone of
  [vault](https://github.com/pocket-nutrition/vault) with a `.venv`) and reads an account back through this
  viewer's code.
- `test/vectors.test.js` compares `test/vectors/` with `../contracts`.

The target calculation (`src/targets/`) is a port of the sandbox reference and runs the shared vector suites of
[contracts](https://github.com/pocket-nutrition/contracts), copied in `test/vectors/` (version in
`CONTRACTS_VERSION`). `test/test-vectors.json` holds the vault protocol's known answers, which `src/crypto.js` must
reproduce.

## Documentation

The vault protocol (keys,
records, threat model) is described in `docs/PROTOCOL.md` of the [vault](https://github.com/pocket-nutrition/vault)
repository.

## Using with Claude Code

This project includes a [CLAUDE.md](CLAUDE.md) that gives Claude Code the commands, the layout and the invariants
that protect your data.

```bash
claude    # Start Claude Code — reads CLAUDE.md automatically
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing expectations, the invariants and the PR
workflow.

## License

This project is licensed under the GNU Affero General Public License v3.0 (`AGPL-3.0-or-later`): see
[LICENSE](LICENSE). The files in `test/vectors/` are vendored unchanged from
[contracts](https://github.com/pocket-nutrition/contracts) and stay under the MPL-2.0. The built page bundles
[libsodium.js](https://github.com/jedisct1/libsodium.js) (ISC license).
