// Makes the key pair Attendance's phone notifications (Web Push) are signed with. Run once:
//   node scripts/att-vapid-keygen.mjs
// and put the two lines it prints in Vercel (Production), then redeploy. Keep the private key secret; changing the pair means everyone
// has to turn notifications on again.
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
const b = (s) => Buffer.from(s, "base64url");
const raw = Buffer.concat([Buffer.from([4]), b(pub.x), b(pub.y)]).toString("base64url");
console.log(`ATT_VAPID_PUBLIC_KEY=${raw}`);
console.log(`ATT_VAPID_PRIVATE_KEY=${priv.d}`);
