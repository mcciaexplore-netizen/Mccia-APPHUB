// "Forgot password?" end to end: the eye on the login password, the link to /forgot-password, the same answer for every email, the reset
// email (caught by a tiny mail catcher this test runs), the /reset-password page and its rules, one-time and one-hour links, signing out
// everywhere, the 3-an-hour limit, and nothing for an inactive account.
//
// The server must send its mail to this test's catcher and build links to itself. Start it with, for example:
//   SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_FROM=hub@test.local APP_BASE_URL=http://localhost:3000 npm start
// then:
//   E2E_RESET_CONFIRM=yes E2E_BASE_URL=http://localhost:3000 E2E_SMTP_PORT=2525 DATABASE_URL=... node tests/e2e/password-reset.mjs
// It creates "zzr-" people (removed at the end) and refuses a Neon database unless E2E_ALLOW_NEON=yes. Test databases only.
import { createRequire } from "node:module";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import net from "node:net";

if (process.env.E2E_RESET_CONFIRM !== "yes") {
  console.error("This test adds and removes people. Set E2E_RESET_CONFIRM=yes against a TEST database and a server started as described at the top.");
  process.exit(2);
}
if (/neon\.tech/.test(process.env.DATABASE_URL ?? "") && process.env.E2E_ALLOW_NEON !== "yes") {
  console.error("DATABASE_URL points at Neon. Use a local test database (or set E2E_ALLOW_NEON=yes for a Neon test branch).");
  process.exit(2);
}
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 2525);

const req = createRequire(import.meta.url);
const pool = new (req("pg").Pool)({ connectionString: process.env.DATABASE_URL });
const q = (t, v = []) => pool.query(t, v).then((r) => r.rows);
const hash = (pw) => { const s = randomBytes(16); return `scrypt$16384$${s.toString("base64")}$${scryptSync(pw, s, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64")}`; };
const sha = (t) => createHash("sha256").update(t).digest("hex");

let pass = 0, fail = 0;
const check = (name, good, detail = "") => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good || !detail ? "" : `  (${detail})`}`); };

// ── A mail catcher: just enough SMTP for nodemailer, no TLS offered. Every message is kept, decoded. ──
const inbox = [];
// Quoted-printable to text, as UTF-8 bytes (so "→" comes back whole).
const qp = (s) => {
  const t = s.replace(/=\r?\n/g, ""), bytes = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "=" && /^[0-9A-F]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...Buffer.from(t[i], "utf8"));
  }
  return Buffer.from(bytes).toString("utf8");
};
function decode(raw) {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  let body = rest.join("\n\n");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(raw)) body = qp(body);
  const b64 = /content-transfer-encoding:\s*base64\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/i.exec(raw);
  if (b64) body = Buffer.from(b64[1].replace(/\s+/g, ""), "base64").toString("utf8");
  const subject = /^subject:\s*(.*)$/im.exec(head)?.[1] ?? "";
  const to = /^to:\s*(.*)$/im.exec(head)?.[1] ?? "";
  return { subject: /=\?utf-8\?/i.test(subject) ? subject.replace(/=\?utf-8\?(Q|B)\?(.*?)\?=/gi, (_, e, t) => (e.toUpperCase() === "B" ? Buffer.from(t, "base64").toString() : qp(t.replace(/_/g, " ")))) : subject, to, body };
}
const smtp = net.createServer((sock) => {
  let data = false, buf = "", msg = "";
  sock.write("220 catcher ESMTP\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === ".") { data = false; inbox.push(decode(msg)); msg = ""; sock.write("250 OK queued\r\n"); } else msg += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO") sock.write("250-catcher\r\n250 8BITMIME\r\n");
      else if (cmd === "HELO") sock.write("250 catcher\r\n");
      else if (cmd === "DATA") { data = true; sock.write("354 go ahead\r\n"); }
      else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
      else sock.write("250 OK\r\n");
    }
  });
  sock.on("error", () => {});
});
await new Promise((r, j) => smtp.once("error", j).listen(SMTP_PORT, "127.0.0.1", r));
const mailFor = async (to, after, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const m = inbox.slice(after).find((x) => x.to.includes(to)); if (m) return m; await new Promise((r) => setTimeout(r, 200)); }
  return null;
};

async function tidy() {
  const ids = (await q("select id from users where email like 'zzr-%'")).map((r) => r.id);
  if (ids.length) {
    await q("delete from access_audit where actor_id = any($1) or target_id = any($2::text[])", [ids, ids]).catch(() => q("delete from access_audit where actor_id = any($1)", [ids]));
    await q("delete from activity_log where user_id = any($1)", [ids]).catch(() => {});
  }
  await q("delete from login_attempts where email like 'zzr-%'");
  await q("delete from users where email like 'zzr-%'");
}

await tidy();
const OLD = "Old-Pass-123", NEW = "Fresh9Pass";
const EMAIL = "zzr-asha@mcciapune.com", OFF = "zzr-gone@mcciapune.com", NOBODY = "zzr-nobody@mcciapune.com";
const [u] = await q("insert into users (name, email, password_hash) values ('Asha', $1, $2) returning id", [EMAIL, hash(OLD)]);
await q("insert into users (name, email, password_hash, is_active) values ('Gone', $1, $2, false)", [OFF, hash(OLD)]);

const pw = req("playwright-core");
const br = await pw.chromium.launch({ channel: "chrome", headless: true }).catch(() => pw.chromium.launch({ headless: true }));
const fresh = async (vp = { width: 1280, height: 860 }) => {
  const ctx = await br.newContext({ viewport: vp, isMobile: vp.width < 768, hasTouch: vp.width < 768 });
  await ctx.addInitScript(() => { try { localStorage.setItem("mccia-install-popup-seen", "1"); localStorage.setItem("mccia-install-snoozed-until", String(Date.now() + 864e5)); } catch {} });
  return { ctx, p: await ctx.newPage() };
};
const signIn = async (p, email, password) => {
  await p.goto(BASE + "/login"); await p.fill("input[name=email]", email); await p.fill("input[name=password]", password);
  await p.click("button[type=submit]");
  // Either the hub (signed in) or back on /login with ?error=1 (refused).
  await p.waitForURL((x) => x.pathname !== "/login" || x.searchParams.has("error"), { timeout: 30000 }).catch(() => {});
  return new URL(p.url()).pathname;
};
const ask = async (p, email) => {
  await p.goto(BASE + "/forgot-password"); await p.fill("input[name=email]", email);
  await p.getByRole("button", { name: "Send reset link" }).click();
  await p.locator("[data-testid=reset-sent]").waitFor({ timeout: 15000 });
  return (await p.locator("[data-testid=reset-sent]").innerText()).trim();
};
const SAME = "If this email is registered, you'll receive a reset link shortly. Check your inbox.";

try {
  // ── Login page: the eye, and the link ──
  for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
    const tag = vp.width < 768 ? "phone" : "laptop";
    const { ctx, p } = await fresh(vp);
    await p.goto(BASE + "/login");
    const field = p.locator("input[name=password]");
    check(`${tag}: password starts hidden`, (await field.getAttribute("type")) === "password");
    await field.fill("Secret-1");
    await p.getByRole("button", { name: "Show password" }).click();
    check(`${tag}: eye shows the password`, (await field.getAttribute("type")) === "text" && (await field.inputValue()) === "Secret-1");
    check(`${tag}: icon becomes "Hide password"`, (await p.getByRole("button", { name: "Hide password" }).count()) === 1);
    await p.getByRole("button", { name: "Hide password" }).click();
    check(`${tag}: eye hides it again`, (await field.getAttribute("type")) === "password");
    await p.mouse.move(0, 0); await p.waitForTimeout(250);
    const eye = await p.getByRole("button", { name: "Show password" }).evaluate((b) => {
      const r = b.getBoundingClientRect(), f = b.previousElementSibling.getBoundingClientRect();
      const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d"); cx.fillStyle = getComputedStyle(b).color; cx.fillRect(0, 0, 1, 1);
      const [R, G, B] = cx.getImageData(0, 0, 1, 1).data;
      return { inside: r.right <= f.right + 1 && r.left > f.left + f.width / 2 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1, rgb: [R, G, B] };
    });
    const [R, G, B] = eye.rgb, light = (R + G + B) / 3;
    check(`${tag}: eye sits inside the field, on the right, in grey`, eye.inside && Math.max(R, G, B) - Math.min(R, G, B) < 30 && light > 110 && light < 200, JSON.stringify(eye));
    check(`${tag}: eye button does not submit the form`, new URL(p.url()).pathname === "/login");
    const link = p.getByRole("link", { name: "Forgot password?" });
    const look = await link.evaluate((a) => { const cs = getComputedStyle(a), r = a.getBoundingClientRect(), f = document.querySelector("input[name=password]").getBoundingClientRect(); return { fs: parseFloat(cs.fontSize), right: Math.abs(r.right - f.right) < 2, below: r.top >= f.bottom }; });
    check(`${tag}: "Forgot password?" is small, right-aligned, under the password`, look.fs <= 13 && look.right && look.below, JSON.stringify(look));
    await link.click(); await p.waitForURL((x) => x.pathname === "/forgot-password");
    check(`${tag}: it opens /forgot-password`, new URL(p.url()).pathname === "/forgot-password");
    check(`${tag}: heading`, (await p.locator("h1").innerText()).trim() === "Reset your password");
    check(`${tag}: subtext`, (await p.locator("main").innerText()).includes("Enter your MCCIA email and we'll send you a reset link."));
    await p.getByRole("link", { name: "Back to login" }).click(); await p.waitForURL((x) => x.pathname === "/login");
    check(`${tag}: "Back to login" goes back`, new URL(p.url()).pathname === "/login");
    const sx = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check(`${tag}: no sideways scroll`, sx);
    await ctx.close();
  }

  const { ctx, p } = await fresh();
  // ── The same answer for everyone; email only for a real, active account ──
  let seen = inbox.length;
  check("unknown email: the usual answer", (await ask(p, NOBODY)) === SAME);
  check("inactive account: the usual answer", (await ask(p, OFF)) === SAME);
  await new Promise((r) => setTimeout(r, 2500));
  check("unknown and inactive: no email sent", inbox.length === seen, String(inbox.length - seen));
  check("unknown and inactive: no link stored", (await q("select count(*)::int as n from hub_password_reset_tokens t join users u on u.id = t.user_id where u.email like 'zzr-%'"))[0].n === 0);

  seen = inbox.length;
  check("real account: the same answer", (await ask(p, "  ZZR-Asha@MCCIApune.com ")) === SAME);
  const mail = await mailFor(EMAIL, seen);
  check("real account: email arrives", !!mail);
  check("email: subject", mail?.subject === "Reset your MCCIA AppHub password", mail?.subject);
  const body = (mail?.body ?? "").replace(/\s+/g, " ");
  for (const t of ["Hi Asha,", "Someone requested a password reset for your MCCIA AppHub account.", "Click the link below to reset your password. This link expires in 1 hour.", "Reset Password →", "If you didn't request this, ignore this email. Your password will not be changed.", "MCCIA AppHub Team"])
    check(`email says: ${t}`, body.includes(t.replace(/'/g, "'")) || body.includes(t.replace(/'/g, "&#39;")));
  const link = /href="([^"]+\/reset-password\?token=[^"]+)"/.exec(mail?.body ?? "")?.[1]?.replace(/&amp;/g, "&");
  const token = link ? new URL(link).searchParams.get("token") : "";
  check("email: link is this site's /reset-password", !!link && link.startsWith(BASE + "/reset-password?token="), link);
  check("email: token is 32 bytes in hex", /^[0-9a-f]{64}$/.test(token ?? ""), token);
  const rows = await q("select token, expires_at, created_at from hub_password_reset_tokens where user_id = $1", [u.id]);
  check("database: one link stored", rows.length === 1, String(rows.length));
  check("database: only its SHA-256 is stored, never the link", rows[0]?.token === sha(token) && rows[0]?.token !== token);
  const life = rows[0] ? (new Date(rows[0].expires_at) - new Date(rows[0].created_at)) / 60000 : 0;
  check("database: expires in 1 hour", Math.abs(life - 60) < 1, String(life));

  // ── A second sign-in somewhere else, which the reset must end ──
  const other = await fresh();
  const otherAt = await signIn(other.p, EMAIL, OLD);
  check("other browser: signed in with the old password", otherAt === "/", otherAt);

  // ── The reset page ──
  await p.goto(link);
  check("reset page: heading", (await p.locator("h1").innerText()).trim() === "Set new password");
  check("reset page: no Referer is sent on from it", (await p.evaluate(() => document.querySelector("meta[name=referrer]")?.content)) === "no-referrer");
  const f1 = p.locator("input[name=password]"), f2 = p.locator("input[name=again]");
  check("reset page: two password fields, both hidden", (await f1.getAttribute("type")) === "password" && (await f2.getAttribute("type")) === "password");
  check("reset page: each has its own eye", (await p.getByRole("button", { name: "Show password" }).count()) === 2);
  await f2.fill("abc"); await p.getByRole("button", { name: "Show password" }).nth(1).click();
  check("reset page: the confirm eye shows only the confirm field", (await f2.getAttribute("type")) === "text" && (await f1.getAttribute("type")) === "password");
  const rules = p.locator("[data-testid=password-rules] li");
  check("reset page: the three requirements shown", (await rules.allInnerTexts()).map((t) => t.replace(/\s*\((met|not met yet)\)/, "").trim()).join("|") === "Minimum 8 characters|At least one uppercase letter|At least one number");
  await f1.fill("abc");
  check("reset page: requirements tick as you type (none yet)", (await rules.allInnerTexts()).every((t) => t.includes("not met yet")));
  await f1.fill("Abcdefg1"); await f2.fill("Abcdefg2");
  check("reset page: requirements all met", (await rules.allInnerTexts()).every((t) => t.includes("(met)")));
  await p.getByRole("button", { name: "Reset password" }).click();
  check("mismatch: error shown", (await p.locator("form [role=alert]").innerText()).includes("do not match"));
  await f1.fill("abcdefgh"); await f2.fill("abcdefgh");
  await p.getByRole("button", { name: "Reset password" }).click();
  check("weak: error shown", /uppercase/i.test(await p.locator("form [role=alert]").innerText()));
  check("weak: nothing changed yet (link still stored)", (await q("select count(*)::int as n from hub_password_reset_tokens where user_id = $1", [u.id]))[0].n === 1);
  await f1.fill(NEW); await f2.fill(NEW);
  await p.getByRole("button", { name: "Reset password" }).click();
  await p.locator("[data-testid=reset-done]").waitFor({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500); // the page re-renders once this browser is signed out: the message must stay
  check("success: message", (await p.locator("[data-testid=reset-done]").innerText()).includes("Password reset successfully! You can now sign in with your new password."));
  check("success: link to sign in", (await p.locator("[data-testid=reset-done] a").getAttribute("href")) === "/login");
  check("success: the link is deleted", (await q("select count(*)::int as n from hub_password_reset_tokens where user_id = $1", [u.id]))[0].n === 0);
  check("success: recorded in the audit log", (await q("select count(*)::int as n from access_audit where action = 'user.password_reset' and actor_id = $1", [u.id]))[0].n === 1);

  // ── Signed out everywhere ──
  await other.p.goto(BASE + "/");
  check("other browser: signed out by the reset", new URL(other.p.url()).pathname === "/login", other.p.url());
  await other.ctx.close();
  check("old password no longer works", (await signIn(p, EMAIL, OLD)) === "/login");
  await p.context().clearCookies();
  check("new password works", (await signIn(p, EMAIL, NEW)) === "/");
  await p.context().clearCookies();

  // ── One time only, and bad or old links ──
  await p.goto(link);
  check("used link: expired message", (await p.locator("[data-testid=reset-expired]").innerText()).includes("This reset link has expired or is invalid."));
  check("used link: no form", (await p.locator("input[name=password]").count()) === 0);
  check("used link: offers a new one", (await p.getByRole("link", { name: /Request a new one/ }).getAttribute("href")) === "/forgot-password");
  await p.goto(BASE + "/reset-password?token=nonsense");
  check("made-up link: expired message", await p.locator("[data-testid=reset-expired]").isVisible());
  await p.goto(BASE + "/reset-password");
  check("no token: expired message", await p.locator("[data-testid=reset-expired]").isVisible());
  const old = randomBytes(32).toString("hex");
  await q("insert into hub_password_reset_tokens (user_id, token, expires_at, created_at) values ($1, $2, now() - interval '1 minute', now() - interval '61 minutes')", [u.id, sha(old)]);
  await p.goto(BASE + `/reset-password?token=${old}`);
  check("link older than an hour: expired message", await p.locator("[data-testid=reset-expired]").isVisible());
  // A page left open past the hour: the form is there, but saving is refused and nothing changes.
  const late = randomBytes(32).toString("hex");
  await q("insert into hub_password_reset_tokens (user_id, token, expires_at) values ($1, $2, now() + interval '3 seconds')", [u.id, sha(late)]);
  await p.goto(BASE + `/reset-password?token=${late}`);
  await p.locator("input[name=password]").waitFor();
  await new Promise((r) => setTimeout(r, 3500));
  await p.fill("input[name=password]", "Another9Pass"); await p.fill("input[name=again]", "Another9Pass");
  await p.getByRole("button", { name: "Reset password" }).click();
  await p.locator("[data-testid=reset-expired]").waitFor({ timeout: 15000 });
  check("page left open past the hour: refused with the expired message", true);
  await p.context().clearCookies();
  check("page left open past the hour: password unchanged", (await signIn(p, EMAIL, NEW)) === "/");
  await p.context().clearCookies();
  await q("delete from hub_password_reset_tokens where user_id = $1", [u.id]);

  // ── 3 an hour per email (one already used above) ──
  seen = inbox.length;
  await ask(p, EMAIL); await ask(p, EMAIL);
  await new Promise((r) => setTimeout(r, 3000));
  const two = inbox.slice(seen).filter((m) => m.to.includes(EMAIL)).length;
  check("limit: 2nd and 3rd request this hour are sent", two === 2, String(two));
  check("limit: a new link replaces the earlier one", (await q("select count(*)::int as n from hub_password_reset_tokens where user_id = $1", [u.id]))[0].n === 1);
  seen = inbox.length;
  check("limit: 4th request gets the usual answer", (await ask(p, EMAIL)) === SAME);
  await new Promise((r) => setTimeout(r, 3000));
  check("limit: 4th request sends nothing", inbox.slice(seen).filter((m) => m.to.includes(EMAIL)).length === 0);
  await ctx.close();
} finally {
  await br.close();
  await tidy();
  const left = (await q("select count(*)::int as n from users where email like 'zzr-%'"))[0].n + (await q("select count(*)::int as n from login_attempts where email like 'zzr-%'"))[0].n;
  check("cleanup: no test people or attempts left", left === 0, String(left));
  await pool.end();
  smtp.close();
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
