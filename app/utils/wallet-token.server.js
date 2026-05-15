/**
 * Wallet token (Phase 2.5 magic-link).
 *
 * Short-lived HMAC-SHA256 token that grants read-only wallet access for
 * one user. Used by WhatsApp template URL buttons so we can deep-link
 * users from a WhatsApp message into a personalised wallet page without
 * requiring a Supabase web session.
 *
 * Format (URL-safe base64):  <payload_b64>.<signature_b64>
 * Payload JSON:              { u: <user_id>, e: <expiry_unix_ms> }
 * Signature:                 HMAC-SHA256(payload_b64, secret)
 *
 * No external JWT library — Node's built-in `crypto` is enough.
 */

import crypto from "node:crypto";

const SECRET = process.env.WA_WALLET_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

if (!SECRET) {
  console.warn("[wallet-token] no SECRET configured — wallet tokens will be insecure");
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (str.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function sign(payloadB64) {
  return b64url(crypto.createHmac("sha256", SECRET || "fallback-insecure-secret").update(payloadB64).digest());
}

/**
 * Issue a wallet-access token for a user.
 * @param {string} userId — auth.users uuid
 * @param {number} ttlMs — optional override (default 24h)
 * @returns {string} signed token
 */
export function signWalletToken(userId, ttlMs = DEFAULT_TTL_MS) {
  const payload = { u: userId, e: Date.now() + ttlMs };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a wallet token. Returns the user_id on success, null on any
 * failure (bad format, bad signature, expired). Never throws.
 */
export function verifyWalletToken(token) {
  try {
    if (!token || typeof token !== "string") return null;
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;

    // Constant-time signature check
    const expected = sign(payloadB64);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf-8"));
    if (!payload?.u || !payload?.e) return null;
    if (Date.now() > payload.e) return null;

    return payload.u;
  } catch {
    return null;
  }
}
