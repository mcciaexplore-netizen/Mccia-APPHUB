import { randomUUID } from "node:crypto";
import { SignJWT, importPKCS8, importSPKI, jwtVerify } from "jose";
import type { SsoRole } from "@/lib/sso-rules";

/**
 * Single sign-on tokens: a short-lived signed JWT (JWS compact, EdDSA / Ed25519) that the hub hands to an application's callback address.
 * The application checks it with the hub's public key. Nothing here touches the database; the route that calls it decides who may get one.
 *
 *   header  { alg: "EdDSA", typ: "JWT", kid: "hub-1" }
 *   claims  iss "mccia-app-hub" · aud <the application's SSO slug> · sub <hub user id> · email · name · role "admin" for the app's App Admins, otherwise "user" · iat · exp (iat + 60 s) · jti
 *
 * The private key lives only in the SSO_PRIVATE_KEY setting: the base64 of a PKCS8 PEM Ed25519 private key, on one line (scripts/sso-keygen.mjs makes one).
 */

export const SSO_ISSUER = "mccia-app-hub";
export const SSO_KID = "hub-1";
const SSO_TOKEN_TTL_SECONDS = 60;

/** The key is not usable. The code is all that is ever logged: never any part of the key. */
export class SsoConfigError extends Error {
  constructor(readonly code: "key_missing" | "key_invalid") {
    super(code);
  }
}

export type SsoClaims = { iss: string; aud: string; sub: string; email: string; name: string; role: SsoRole; iat: number; exp: number; jti: string };

/** Everything the token says, for one person opening one application. `now` and `jti` are for tests; by default it is now and a fresh random id. */
export function buildClaims(input: { slug: string; user: { id: string; email: string; name: string }; role: SsoRole; now?: Date | number; jti?: string }): SsoClaims {
  const ms = input.now === undefined ? Date.now() : typeof input.now === "number" ? input.now : input.now.getTime();
  const iat = Math.floor(ms / 1000);
  return {
    iss: SSO_ISSUER, aud: input.slug, sub: input.user.id, email: input.user.email, name: input.user.name, role: input.role,
    iat, exp: iat + SSO_TOKEN_TTL_SECONDS, jti: input.jti ?? randomUUID(),
  };
}

let cached: { raw: string; key: CryptoKey } | null = null;

/** Reads SSO_PRIVATE_KEY (base64 of a PKCS8 PEM Ed25519 private key). Throws SsoConfigError when it is missing or not such a key. */
export async function loadSigningKey(raw: string | undefined = process.env.SSO_PRIVATE_KEY): Promise<CryptoKey> {
  const value = (raw ?? "").trim();
  if (!value) throw new SsoConfigError("key_missing");
  if (cached?.raw === value) return cached.key;
  try {
    const pem = Buffer.from(value, "base64").toString("utf8");
    if (!pem.includes("-----BEGIN PRIVATE KEY-----")) throw new Error("not a PKCS8 PEM");
    const key = await importPKCS8(pem, "EdDSA");
    if (key.algorithm.name !== "Ed25519") throw new Error("not Ed25519");
    cached = { raw: value, key };
    return key;
  } catch {
    throw new SsoConfigError("key_invalid");
  }
}

/** Signs the claims as a compact JWT with the hub's key. */
export function signSsoToken(key: CryptoKey, claims: SsoClaims): Promise<string> {
  return new SignJWT({ ...claims }).setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: SSO_KID }).sign(key);
}

/**
 * What an application does with a token: check the signature, the issuer, that it was meant for `audience` (its own slug) and that it has
 * not expired. Used only by the tests here (the applications ship their own check); `publicKeyPem` is the PEM the key generator wrote.
 */
export async function verifySsoToken(token: string, publicKeyPem: string, opts: { audience: string; now?: Date }) {
  const key = await importSPKI(publicKeyPem, "EdDSA");
  const { payload, protectedHeader } = await jwtVerify(token, key, { issuer: SSO_ISSUER, audience: opts.audience, algorithms: ["EdDSA"], typ: "JWT", currentDate: opts.now });
  return { claims: payload as unknown as SsoClaims, header: protectedHeader };
}
