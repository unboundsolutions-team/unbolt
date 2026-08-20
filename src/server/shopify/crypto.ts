import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encryption for Shopify access tokens at rest.
 *
 * ── Why bother, when the database is already private ────────────────
 * A Shopify access token is not our credential — it is standing write access to
 * someone else's business. Orders, customers, themes. The blast radius of a
 * leaked `stores` row is a merchant's entire storefront, and the ways a row
 * leaks without the database being "breached" are mundane: a support engineer
 * running a SELECT, a database branch seeded into a deploy preview (which is
 * exactly what Netlify DB does on every PR), a logged query, a backup.
 *
 * Encrypting means the token is only readable where the key is, which is the
 * server runtime and nowhere else.
 *
 * ── AES-256-GCM, not CBC ────────────────────────────────────────────
 * GCM is authenticated: a tampered ciphertext fails to decrypt rather than
 * decrypting to garbage that then gets sent somewhere as a bearer token.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const TAG_BYTES = 16;
const VERSION = "v1";

/**
 * Derive a 32-byte key from the configured secret.
 *
 * scrypt with a fixed salt rather than a random one: the "salt" here is not
 * defending against a rainbow table of user passwords, it is stretching one
 * long-lived high-entropy application secret. A random salt would have to be
 * stored alongside every row and would buy nothing.
 */
function keyFrom(secret: string): Buffer {
  return scryptSync(secret, "unbolt.shopify.token.v1", 32);
}

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

/**
 * The key, read at call time rather than module load.
 *
 * Reading it at module scope would make importing this file throw during the
 * build, before any environment variable exists — the same trap `db/client.ts`
 * documents.
 */
function requireSecret(): string {
  const secret = process.env["SHOPIFY_TOKEN_KEY"] ?? process.env["BETTER_AUTH_SECRET"];
  if (!secret || secret.length < 32) {
    throw new TokenCryptoError(
      "SHOPIFY_TOKEN_KEY is not set (or is under 32 characters). It encrypts " +
        "merchant access tokens at rest and has no safe default.",
    );
  }
  return secret;
}

/**
 * → `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 *
 * The version prefix is what makes a future key rotation or algorithm change
 * possible without a flag day: a reader can tell which scheme produced a value
 * instead of guessing from its length.
 */
export function encryptToken(plaintext: string): string {
  if (plaintext.length === 0) throw new TokenCryptoError("Refusing to encrypt an empty token.");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFrom(requireSecret()), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join(".");
}

/** Reverses {@link encryptToken}. Throws on tampering — never returns garbage. */
export function decryptToken(encoded: string): string {
  const parts = encoded.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenCryptoError("Stored token is not in a recognised format.");
  }

  const iv = unb64(parts[1]!);
  const tag = unb64(parts[2]!);
  const ciphertext = unb64(parts[3]!);

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new TokenCryptoError("Stored token has an invalid envelope.");
  }

  const decipher = createDecipheriv(ALGORITHM, keyFrom(requireSecret()), iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM's authentication failing means the ciphertext or the key is wrong.
    // Either way the value must not be used, and the original error text says
    // nothing useful to anyone but an attacker.
    throw new TokenCryptoError("Stored token failed authentication and was not decrypted.");
  }
}

/**
 * The last four characters, for showing a merchant which token is connected
 * without putting the credential on a screen or into a log.
 */
export function tokenFingerprint(plaintext: string): string {
  return plaintext.length <= 4 ? "••••" : `••••${plaintext.slice(-4)}`;
}

function b64(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function unb64(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
