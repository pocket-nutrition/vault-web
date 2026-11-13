# Security policy

Pocket Nutrition Vault Web runs in your browser with two sensitive things in it: the passphrase you type and
the journal it decrypts. Reports that help keep both safe are welcome.

## Reporting a vulnerability

Report it privately with GitHub's private vulnerability reporting:

**[Report a vulnerability](https://github.com/pocket-nutrition/vault-web/security/advisories/new)**
(the Security tab of this repository, then "Report a vulnerability").

Please do not open a public issue or pull request for a vulnerability, and do not share details elsewhere
until a fix is released.

A useful report says which file or header is affected, how to reproduce it (with the browser, and with a test
account rather than a real one) and what an attacker gains. **Never put a real passphrase, recovery code,
device key or real journal data in a report.**

Reports are handled by the maintainers on a best-effort basis. You will get an acknowledgement in the advisory
thread and be kept informed until the problem is fixed, and you will be credited in the advisory unless you
prefer to stay anonymous. Please give us a reasonable time to fix a problem before you disclose it, test only
against accounts you own, and do not access, change or delete anyone else's data.

## Supported versions

Only the latest release is supported. Fixes land on `main` and ship as a new release, published as the
container image `ghcr.io/pocket-nutrition/vault-web`. The official deployment is
[me.pocketnutrition.org](https://me.pocketnutrition.org).

## What the page protects, and what it cannot

- The passphrase and every key live in the memory of the open tab only. The vault server receives a login hash
  derived from the passphrase and holds ciphertext it cannot read. Nothing is written to browser storage, and
  the session ends on log out, when the tab closes, or after 10 minutes without activity.
- A strict Content Security Policy (`nginx.conf`) allows scripts from the page itself only (plus WebAssembly,
  which libsodium needs to run Argon2id), no inline script or style, and network requests only to the official
  vault and the official API.
- It cannot protect you from a compromised browser or device, or from a modified copy of the page served by
  someone else. The page is delivered over the web, so you trust whoever serves it: check the address before
  you type your passphrase, or build the page yourself from this repository.

## In scope

Anything in this repository that could expose a passphrase, a key or decrypted data, or weaken the protections
above:

- **Key derivation** (`src/crypto.js`): deriving the login hash and the wrap key with Argon2id, the floor on the
  settings a server announces, passphrase normalisation, and the handling and wiping of key material.
- **Decryption** (`src/crypto.js`, `src/journal.js`, `src/targetRecords.js`): opening the keyring and the records
  (XChaCha20-Poly1305, with the record's metadata as associated data), trusting anything that failed to
  authenticate, and handling decrypted content an attacker might influence: HTML or script injection into the
  page, formula injection in the CSV export.
- **The CSP and the response headers** (`nginx.conf`): anything that lets a script, a style or a network request
  reach somewhere other than this origin, the official vault or the official API; framing; caching of responses.
- **The build** (`scripts/build.mjs`, `Dockerfile`, `package-lock.json`, `.github/workflows/ci.yml` and the
  published image): anything that makes the shipped page differ from the source in this repository, pulls in
  third-party code at run time, or lets a release be tampered with.
- **Network behavior and sessions** (`src/vault.js`, `src/referenceIntakes.js`, `src/main.js`): credentials,
  cookies, referrers or followed redirects where there should be none; data kept anywhere but the memory of the
  page; a session that outlives log out, closing the tab or the idle limit.

## Out of scope

- Vulnerabilities in the [vault](https://github.com/pocket-nutrition/vault) server, the
  [API](https://github.com/pocket-nutrition/api) or the apps: please report them in the repository concerned.
  If you are not sure where a problem belongs, report it here and we will route it.
- A compromised browser or device: malware, malicious browser extensions, keyloggers, someone reading your screen.
- A weak passphrase chosen by a user.
- Copies of the page served by someone else, and deployments that remove or change the headers in `nginx.conf`.
- Findings that need a modified build, and volumetric denial of service.
