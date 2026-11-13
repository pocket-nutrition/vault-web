// SPDX-License-Identifier: AGPL-3.0-or-later

// The few vault calls the viewer needs. Read-only: log in (which makes this browser a device), read every
// record, log out. Requests carry no cookies and no referrer, and a redirect is an error: the login hash
// and the device key must never follow a response somewhere else.

export const OFFICIAL_VAULT = 'https://vault.pocketnutrition.org';
export const DEVICE_LABEL = 'Web browser';

/**
 * `kind` is what the screen words: offline, credentials, twoFactorRequired (the passphrase was right, a code
 * is needed), invalidTwoFactor, locked, unauthorized, server, malformed.
 */
export class VaultApiError extends Error {
  constructor(kind, retryAfter = null) {
    super(kind);
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

/** FastAPI nests the error code: `{"detail":{"error":"two_factor_required"}}`. Null when there is none. */
async function errorCode(response) {
  try {
    const body = await response.json();
    return typeof body?.detail?.error === 'string' ? body.detail.error : null;
  } catch {
    return null;
  }
}

export function createVaultClient({ baseUrl = OFFICIAL_VAULT, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
  async function call(path, { method = 'GET', body, key, isLogin = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers.Authorization = `Bearer ${key}`;
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/v1/${path}`, {
        method, headers, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new VaultApiError('offline');
    }
    if (response.status === 401) {
      if (!isLogin) throw new VaultApiError('unauthorized');
      const code = await errorCode(response);
      if (code === 'two_factor_required') throw new VaultApiError('twoFactorRequired');
      if (code === 'invalid_two_factor') throw new VaultApiError('invalidTwoFactor');
      throw new VaultApiError('credentials');
    }
    if (response.status === 429) {
      const wait = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
      throw new VaultApiError('locked', Number.isFinite(wait) ? wait : null);
    }
    if (!response.ok) throw new VaultApiError('server');
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw new VaultApiError('malformed');
    }
  }

  return {
    async prelogin(username) {
      return call('accounts/prelogin', { method: 'POST', body: { username } });
    },

    /** `secondFactor` is `{ totpCode }` or `{ recoveryCode }` when the account has two-factor login on. */
    async login(username, authHash, secondFactor = {}) {
      const body = { username, auth_hash: authHash, device_label: DEVICE_LABEL };
      if (secondFactor.totpCode) body.totp_code = secondFactor.totpCode;
      if (secondFactor.recoveryCode) body.recovery_code = secondFactor.recoveryCode;
      const session = await call('login', { method: 'POST', isLogin: true, body });
      if (typeof session?.api_key !== 'string' || typeof session?.account_id !== 'string' ||
          typeof session?.keyring?.blob !== 'string') {
        throw new VaultApiError('malformed');
      }
      return session;
    },

    /** Every record the account holds, tombstones included, across pages. */
    async readAll(apiKey) {
      const records = [];
      let cursor = 0;
      for (;;) {
        const page = await call(`sync?since=${cursor}`, { key: apiKey });
        if (!Array.isArray(page?.records)) throw new VaultApiError('malformed');
        records.push(...page.records);
        if (!page.has_more || !(page.cursor > cursor)) return records;
        cursor = page.cursor;
      }
    },

    /** Revokes this browser's key. Best effort: the page forgets it either way. */
    async logout(apiKey) {
      try {
        await call('logout', { method: 'POST', key: apiKey });
      } catch {
        // The key then stays valid until it is revoked from a phone; nothing more to do here.
      }
    },
  };
}
