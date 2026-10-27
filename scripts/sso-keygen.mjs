// Makes a fresh Ed25519 key pair for single sign-on and writes it as two files in the folder given as the only argument:
//   sso-private.b64  the base64 of the PKCS8 PEM private key, on one line. This is the hub's SSO_PRIVATE_KEY setting. Keep it secret.
//   sso-public.b64   the base64 of the SPKI PEM public key, on one line. The application verifies tokens with this one; it is not secret.
// It never overwrites an existing file, and prints only the two file paths (never a key).
//
//   node scripts/sso-keygen.mjs ~/sso-keys
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("Usage: node scripts/sso-keygen.mjs <folder to write sso-private.b64 and sso-public.b64 into>");
  process.exit(2);
}
const dir = resolve(dirArg);
const files = { private: join(dir, "sso-private.b64"), public: join(dir, "sso-public.b64") };
for (const f of Object.values(files)) {
  if (existsSync(f)) {
    console.error(`Refusing to overwrite ${f}. Choose another folder, or delete it yourself first.`);
    process.exit(1);
  }
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const b64 = (pem) => Buffer.from(pem, "utf8").toString("base64");
mkdirSync(dir, { recursive: true, mode: 0o700 });
// "wx": fail rather than overwrite, even if a file appeared since the check above. The private key is readable by its owner only.
writeFileSync(files.private, b64(privateKey.export({ type: "pkcs8", format: "pem" })) + "\n", { flag: "wx", mode: 0o600 });
writeFileSync(files.public, b64(publicKey.export({ type: "spki", format: "pem" })) + "\n", { flag: "wx", mode: 0o644 });
console.log(files.private);
console.log(files.public);
