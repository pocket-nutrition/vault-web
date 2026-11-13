// SPDX-License-Identifier: AGPL-3.0-or-later

// The vault's cryptography, as docs/PROTOCOL.md specifies it (https://github.com/pocket-nutrition/vault).
// Everything here runs in the browser: the passphrase and every key stay in memory of this page and are never
// sent. The server sees only the login hash derived from the passphrase.

export const KDF_MIN_OPS = 3;
export const KDF_MAX_OPS = 10;
export const KDF_MIN_MEM = 64 * 1024 * 1024;
export const KDF_MAX_MEM = 1024 * 1024 * 1024;
const KDF_SALT_BYTES = 16;
const KEY_BYTES = 32;
const NONCE_BYTES = 24;

export class CryptoError extends Error {}

const utf8 = new TextEncoder();

/**
 * @param {typeof import('libsodium-wrappers-sumo')} sodium an initialised libsodium (`await sodium.ready`)
 */
export function createCrypto(sodium) {
  const b64 = (text) => sodium.from_base64(text, sodium.base64_variants.ORIGINAL);

  /** Argon2id settings a server announces are only trusted above the same floor the apps enforce. */
  function isAcceptableKdf(kdf) {
    if (!kdf || kdf.alg !== 'argon2id') return false;
    if (!Number.isInteger(kdf.opslimit) || kdf.opslimit < KDF_MIN_OPS || kdf.opslimit > KDF_MAX_OPS) return false;
    if (!Number.isInteger(kdf.memlimit) || kdf.memlimit < KDF_MIN_MEM || kdf.memlimit > KDF_MAX_MEM) return false;
    try {
      return b64(kdf.salt).length === KDF_SALT_BYTES;
    } catch {
      return false;
    }
  }

  /**
   * master = Argon2id(NFKC(passphrase)); auth_hash and wrap_key are independent subkeys of it.
   * Slow and memory-hungry by design (about 64 MiB).
   */
  function deriveCredentials(passphrase, kdf) {
    if (!isAcceptableKdf(kdf)) throw new CryptoError('unacceptable kdf');
    const password = utf8.encode(passphrase.normalize('NFKC'));
    if (password.length === 0) throw new CryptoError('empty passphrase');
    const master = sodium.crypto_pwhash(
      KEY_BYTES, password, b64(kdf.salt), kdf.opslimit, kdf.memlimit, sodium.crypto_pwhash_ALG_ARGON2ID13);
    try {
      return {
        authHash: sodium.to_base64(
          sodium.crypto_kdf_derive_from_key(KEY_BYTES, 1, 'pnvauth1', master), sodium.base64_variants.ORIGINAL),
        wrapKey: sodium.crypto_kdf_derive_from_key(KEY_BYTES, 2, 'pnvwrap1', master),
      };
    } finally {
      sodium.memzero(master);
    }
  }

  /** `base64(nonce[24] || XChaCha20-Poly1305 ciphertext)` opened with `key` and the exact `aad` string. */
  function open(ciphertextB64, key, aad) {
    let raw;
    try {
      raw = b64(ciphertextB64);
    } catch {
      throw new CryptoError('malformed ciphertext');
    }
    if (raw.length <= NONCE_BYTES) throw new CryptoError('malformed ciphertext');
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null, raw.subarray(NONCE_BYTES), utf8.encode(aad), raw.subarray(0, NONCE_BYTES), key);
    } catch {
      // Wrong key, tampered data or AAD that does not match: indistinguishable on purpose.
      throw new CryptoError('decryption failed');
    }
  }

  /** The user key, from the keyring blob the server stores and the passphrase-derived wrap key. */
  function unwrapUserKey(keyringBlob, wrapKey) {
    let blob;
    try {
      blob = JSON.parse(keyringBlob);
    } catch {
      throw new CryptoError('unreadable keyring');
    }
    if (blob?.v !== 1 || typeof blob.passphrase_wrapped_user_key !== 'string') {
      throw new CryptoError('unreadable keyring');
    }
    const userKey = open(blob.passphrase_wrapped_user_key, wrapKey, 'pnv1|keyring|passphrase');
    if (userKey.length !== KEY_BYTES) throw new CryptoError('unreadable keyring');
    return { userKey, kdf: blob.kdf };
  }

  /** `pnv1|<account>|<record>|<type>|<scope or "">|<revision>|<key_id>`: binds a ciphertext to its metadata. */
  function recordAAD(accountId, record) {
    return ['pnv1', accountId, record.id, record.type, record.scope_id ?? '', String(record.revision), record.key_id]
      .join('|');
  }

  /** The plaintext of a record encrypted under the user key, or null if it is not one that opens. */
  function openRecord(accountId, userKey, record) {
    if (record.key_id !== 'user' || record.deleted) return null;
    try {
      return open(record.ciphertext, userKey, recordAAD(accountId, record));
    } catch {
      return null;
    }
  }

  return { isAcceptableKdf, deriveCredentials, unwrapUserKey, open, openRecord, recordAAD };

}

/**
 * Whether two KDF settings are the same, field by field. Never compare their JSON: the phones write the
 * keyring with sorted keys while the server answers prelogin in its own field order, so equal settings
 * serialise differently.
 */
export function sameKdf(a, b) {
  return ['alg', 'salt', 'opslimit', 'memlimit'].every((field) => a?.[field] === b?.[field]);
}
