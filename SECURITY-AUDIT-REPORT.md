# Security Audit Report — MCCIA App Hub

Date: 27 October 2026 · Scope: this repository (commit `7ff2124` plus uncommitted work), live headers of https://mccia-apphub.vercel.app (one ordinary request, no attack traffic) · Phase 1: audit only, nothing changed.

---

## A. Executive summary

The App Hub is a Next.js 16 application on Vercel with a Neon Postgres database and its own email-and-password sign-in. The core is well built: passwords are hashed with scrypt, sign-in cookies are signed and HttpOnly, every server action and API checks who is asking on the server, SQL is parameterised, file downloads check that the person may see the request, and admin actions are audited.

The two serious gaps are: **sign-in can be guessed without limit** (no lockout or slow-down on the login or Administrator unlock forms), and **the installed Next.js version has published critical and high vulnerabilities** (one, a denial of service through Server Actions, applies to this app). Failed sign-ins are also not recorded, so an attack would go unnoticed.

**Overall risk rating: High.** The fixes for both High findings are small and do not change how people use the app beyond a short wait after many wrong passwords.

---

## B. Summary table

| ID | Finding | Severity | Area | OWASP | Effort |
|---|---|---|---|---|---|
| H-1 | No brute-force protection on sign-in or Administrator unlock | High | Authentication | A07 Identification & Authentication Failures | M |
| H-2 | Next.js 16.3.7 has published critical/high advisories | High | Dependencies | A06 Vulnerable & Outdated Components | S |
| M-1 | Failed (and successful) sign-ins are never recorded; the Sign-ins tab is always empty | Medium | Logging | A09 Security Logging & Monitoring Failures | S |
| M-2 | zod 4.6.5: memory exhaustion advisory | Medium | Dependencies | A06 | S |
| M-3 | No multi-factor sign-in, including for the all-powerful Support Admin | Medium | Authentication | A07 | L |
| M-4 | No Content-Security-Policy header | Medium | Headers | A05 Security Misconfiguration | M |
| M-5 | Abandoned uploads are never deleted; storage can be filled | Medium | File uploads | A04 Insecure Design | M |
| L-1 | nodemailer 10.1.1: address-parsing advisories | Low | Dependencies | A06 | S |
| L-2 | Sign-ins cannot be revoked on the server; logout only clears the cookie | Low | Sessions | A07 | M |
| L-3 | Approval System admin API skips the Administrator re-unlock | Low | Authorization | A01 Broken Access Control | S |
| L-4 | Someone still on a temporary password can call APIs and actions | Low | Authentication | A07 | S |
| L-5 | Every signed-in user receives all staff names and emails | Low | Data exposure | A01 | S |
| L-6 | `X-Powered-By: Next.js` header; no Permissions-Policy | Low | Headers | A05 | S |
| L-7 | Application link check: DNS-rebinding window | Low | SSRF | A10 Server-Side Request Forgery | M |
| L-8 | Optional `pg` database driver turns off TLS certificate checks | Low | Data in transit | A02 Cryptographic Failures | S |
| I-1 | Server errors are logged whole and may include personal data | Info | Logging | A09 | S |
| I-2 | Invite links fall back to the request's Host header | Info | Input handling | A05 | S |

Counts: **0 Critical · 2 High · 5 Medium · 8 Low · 2 Info** (17 findings).

---

## C. Detailed findings

### H-1 — No brute-force protection on sign-in or Administrator unlock
- **Severity:** High · **Confidence:** Confirmed
- **Location:** `src/actions/auth.ts:20-28` (`login`), `src/actions/auth.ts:38-47` (`unlockAdmin`), `src/lib/auth.ts:67` ("Never locks anyone out")
- **Evidence:** `login` calls `authenticate` and on failure only redirects to `/login?error=1`. There is no count of failures, no delay, and no lockout, per email or per IP. The comment reads "A wrong password just fails and can be tried again straight away." The app has a rate limiter (`src/lib/approvals/ratelimit.ts`) but it is used only for uploads and request submission.
- **Risk:** Anyone on the internet can try passwords for any staff email as fast as they like. The Support Admin account (whose email is guessable) has full control of every account and application. Temporary passwords are 12 random characters (strong), but passwords people choose need only 10 characters with one letter and one number.
- **Fix:** Count failures per email and per IP (the existing `apr_rate_limits` table can hold this). After 5 failures in 15 minutes, refuse further tries for that email/IP for 15 minutes, with the same generic message. Apply the same to `unlockAdmin` and `changePassword`. Keep the Support Admin able to recover (the lock expires on its own).
- **Effort:** M
- **User impact:** Yes. After 5 wrong passwords in a row, the person waits up to 15 minutes. Normal sign-ins are unchanged.

### H-2 — Next.js 16.3.7 has published critical and high advisories
- **Severity:** High · **Confidence:** Confirmed (vulnerable version), applicability noted per advisory
- **Location:** `package.json` (`"next": "16.3.7"`); `npm audit --omit=dev`
- **Evidence:** `npm audit` reports next `16.0.0 – 16.4.0` as **critical**, including GHSA-p3m5-59mp-jv5r (Denial of Service in App Router using Server Actions), GHSA-2464-fhr4-w9xw (RCE in Image Optimization with SVG), GHSA-673q-mjm6-r5xr (RCE in `use cache`), GHSA-cjq9-62q9-8jv4 (SSRF in Image Optimization) and several cache-poisoning issues. This app **uses Server Actions heavily** (the DoS applies). It does **not** use `next/image`, `use cache` or Draft Mode (checked with grep), which lowers the practical risk of the RCE and SSRF items, though the image optimisation endpoint exists by default.
- **Risk:** An unauthenticated attacker could slow down or take down the site (Server Actions DoS). The others become exploitable if those features are ever used.
- **Fix:** Upgrade `next` and `eslint-config-next` to the latest 16.x (16.4.3 at the time of writing), then build and test.
- **Effort:** S
- **User impact:** No.

### M-1 — Sign-in attempts are never recorded
- **Severity:** Medium · **Confidence:** Confirmed
- **Location:** `src/db/schema.ts:264` (`login_attempts` table); read in `src/lib/sign-ins.ts:20`; never written (no `insert` into `loginAttempts` anywhere in `src/`)
- **Evidence:** The Activity Log "Sign-ins" tab reads `login_attempts`, but no code writes to it. Successful sign-ins are written to `activity_log` (`src/lib/auth.ts:103`); failed ones are not recorded anywhere.
- **Risk:** A password-guessing attack (see H-1) leaves no trace, and the Sign-ins tab gives a false sense of monitoring.
- **Fix:** In `login` (and `unlockAdmin`), insert a row for every attempt: email (lower-cased), IP (`clientIp`), success. The same rows can drive the H-1 limit.
- **Effort:** S
- **User impact:** No (the Sign-ins tab starts showing data).

### M-2 — zod 4.6.5: memory exhaustion advisory
- **Severity:** Medium (advisory rates it High) · **Confidence:** Confirmed (version), Likely (impact)
- **Location:** `package.json` (`"zod": "^4.6.5"`); GHSA-mrhx-c7xc-m3w5
- **Evidence:** `npm audit` flags zod `<4.6.6`. Every server action and API body is validated with zod, including array inputs (`uuidList`, import rows of up to 2,000).
- **Risk:** A signed-in user (the API routes require sign-in) could send an oversized body that makes validation use excessive memory, slowing or crashing a function instance. Vercel's 4.5 MB body limit and the 3 MB Server Actions limit (`next.config.ts:5`) reduce the effect, so this is rated Medium.
- **Fix:** `npm audit fix` (moves to zod ≥ 4.6.6), then build and test.
- **Effort:** S
- **User impact:** No.

### M-3 — No multi-factor sign-in
- **Severity:** Medium · **Confidence:** Confirmed
- **Location:** `src/lib/auth.ts` (email and password only); Support Admin password in the environment (`SUPPORT_ADMIN_PASSWORD`, `src/lib/auth.ts:31`)
- **Evidence:** No TOTP, email code or passkey exists. The Support Admin is a single shared environment password with full power, and that password cannot be changed in the app (`src/actions/auth.ts:61`).
- **Risk:** One leaked or guessed password gives full control. Combined with H-1, this is the main route to a takeover.
- **Fix (later):** Add TOTP (authenticator app) for the Support Admin and Admins first, required at sign-in and at Administrator unlock. Fix H-1 first; it removes most of the immediate risk.
- **Effort:** L
- **User impact:** Yes. Administrators would enter a 6-digit code at sign-in.

### M-4 — No Content-Security-Policy
- **Severity:** Medium · **Confidence:** Confirmed
- **Location:** `next.config.ts:7-17` (headers); live response has no `content-security-policy`
- **Evidence:** Live headers include HSTS, `X-Frame-Options: DENY`, `nosniff` and `Referrer-Policy`, but no CSP.
- **Risk:** No XSS was found (React escapes output; the only `dangerouslySetInnerHTML` is a fixed string in `src/app/layout.tsx:24`; email HTML is escaped). A CSP is the safety net if one appears later, for example in a future feature or a dependency.
- **Fix:** Add a CSP in `next.config.ts`, starting in Report-Only mode: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Tighten `script-src` with nonces later.
- **Effort:** M
- **User impact:** No, if tested in Report-Only first.

### M-5 — Abandoned uploads are never deleted
- **Severity:** Medium · **Confidence:** Likely (no cleanup code or cron found; needs verification that nothing outside the repo cleans up)
- **Location:** `src/lib/approvals/files.ts:19` (`startUpload`), `src/app/api/approvals/uploads/route.ts:10` (limit 60 starts per 10 minutes), `src/lib/approvals/request-schemas.ts:5` (10 MB per file); no `vercel.json` cron; no delete of unattached `apr_files`
- **Evidence:** Files are stored as chunks in Postgres (`apr_file_chunks`). A file that is uploaded but never attached to a request stays forever.
- **Risk:** Any signed-in user can upload up to about 600 MB every 10 minutes that is never cleaned up, filling the Neon database (cost, and possibly hitting the storage limit, which would stop the whole app). Old orphan files also keep data no one needs.
- **Fix:** A daily cleanup (Vercel Cron calling a protected route, or a scheduled SQL job) deleting `apr_files` with `attached = false` older than 24 hours, plus their chunks. Consider a per-user daily byte cap.
- **Effort:** M
- **User impact:** No.

### L-1 — nodemailer 10.1.1: address-parsing advisories
- **Severity:** Low · **Confidence:** Confirmed (version), Likely (low impact)
- **Location:** `package.json`; GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h
- **Evidence:** Recipients are always account emails from the database (`src/lib/approvals/notify.ts:34`, `src/lib/invites.ts`), validated by `emailSchema` and the domain allowlist, not typed by requesters.
- **Risk:** Crafted addresses could add recipients; the current data flow makes this unlikely.
- **Fix:** `npm audit fix` (nodemailer ≥ 10.1.4).
- **Effort:** S
- **User impact:** No.

### L-2 — Sign-ins cannot be revoked on the server
- **Severity:** Low · **Confidence:** Confirmed
- **Location:** `src/lib/session.ts` (stateless signed cookie, 8 hours); `src/actions/auth.ts:30-35` (`logout` deletes cookies only)
- **Evidence:** A session is valid until it expires, unless the person's password changes or the account is deactivated (both checked in `getCurrentUser`, `src/lib/permissions.ts:20-21`).
- **Risk:** A stolen session cookie (for example from a shared computer where someone did not log out) keeps working for up to 8 hours, even after "Log out" on another device.
- **Fix:** Add a per-user `session_version` column included in the token. Bump it on logout ("sign out everywhere") and on role change.
- **Effort:** M
- **User impact:** No (optionally a "Sign out of all devices" button).

### L-3 — Approval System admin API skips the Administrator re-unlock
- **Severity:** Low · **Confidence:** Confirmed
- **Location:** `src/lib/approvals/guard.ts:42-53` (`route` with `roles: ["approvals_admin"]`); e.g. `src/app/api/approvals/form-fields/[form]/route.ts:16`, `settings/route.ts:8`, `roles/route.ts:10`, `masters/*`
- **Evidence:** The pages that edit forms (`/administrator/approval-forms/*`) require the Administrator unlock (`requireHeadAdmin`), but the API they call checks only the role.
- **Risk:** Only the Support Admin holds `approvals_admin`, so this is a defence-in-depth gap: a stolen Support Admin session cookie can change forms, settings and categories without the extra password step.
- **Fix:** In `route()`, for write methods with the `approvals_admin` role, also require a valid admin unlock cookie for that user.
- **Effort:** S
- **User impact:** Possibly. The Support Admin may be asked for their password again before editing categories on the Approval System pages.

### L-4 — Temporary-password users can call APIs and actions
- **Severity:** Low · **Confidence:** Confirmed
- **Location:** `src/lib/permissions.ts:16-23` (`getCurrentUser` ignores `mustChangePassword`); only page guards redirect (`requireUser`, line 38)
- **Evidence:** API routes (`route()`) and server actions use `getCurrentUser`, so someone signed in with an emailed temporary password can submit requests or use staff actions without first choosing their own password.
- **Risk:** It weakens the "must change at first sign-in" control; whoever reads the email has full use of the account until it expires (7 days).
- **Fix:** Refuse API and server-action calls (except `changePassword`) while `mustChangePassword` is true.
- **Effort:** S
- **User impact:** No (the pages already send them to change the password).

### L-5 — Every signed-in user receives all staff names and emails
- **Severity:** Low · **Confidence:** Confirmed
- **Location:** `src/lib/approvals/form-data.ts:31` (`people: ... email: u.email`); `src/lib/approvals/host-adapter.ts:51` (`listUsers`)
- **Evidence:** The expense form is sent the full list of active staff with their email addresses, for the Name dropdown and email autofill.
- **Risk:** Any staff account (or a stolen one) can harvest the whole staff email list, which is useful for phishing.
- **Fix:** Send only `{ id, name }` and fill the email on the server (or fetch one person's email when picked).
- **Effort:** S
- **User impact:** Possibly. The email field would fill after choosing a name instead of instantly. **Ask before changing.**

### L-6 — `X-Powered-By` header; no Permissions-Policy
- **Severity:** Low · **Confidence:** Confirmed (live headers)
- **Location:** `next.config.ts` (no `poweredByHeader: false`)
- **Evidence:** Live response includes `x-powered-by: Next.js` and no `permissions-policy`.
- **Risk:** Tells attackers the framework, which helps target H-2. Minor.
- **Fix:** `poweredByHeader: false`; add `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **Effort:** S
- **User impact:** No.

### L-7 — Application link check: DNS-rebinding window
- **Severity:** Low · **Confidence:** Likely
- **Location:** `src/lib/app-checks.ts:22-27, 40-42`
- **Evidence:** The check resolves the hostname and refuses private addresses (good, `src/lib/net-guard.ts`), then `fetch` resolves it again. A hostname that changes its answer between the two lookups could reach an internal address.
- **Risk:** Needs an administrator with the Applications area to enter a malicious address. On Vercel there is little internal network to reach. Low.
- **Fix:** Fetch using the IP already checked (custom DNS lookup on an undici Agent) while sending the original Host/SNI.
- **Effort:** M
- **User impact:** No.

### L-8 — Optional `pg` driver turns off TLS certificate checks
- **Severity:** Low · **Confidence:** Needs verification (only applies if `DB_DRIVER=pg`)
- **Location:** `src/db/index.ts:41-44` (`ssl: { rejectUnauthorized: false }`, or no TLS at all unless `DATABASE_SSL=true`)
- **Evidence:** The default driver is Neon over HTTPS (secure). The alternative `pg` path accepts any certificate, or none.
- **Risk:** If production were switched to `pg`, database traffic could be intercepted.
- **Fix:** Use `ssl: { rejectUnauthorized: true }` (Neon has valid certificates) and require TLS. Confirm Vercel does not set `DB_DRIVER=pg`.
- **Effort:** S
- **User impact:** No.

### I-1 — Server errors are logged whole
- **Severity:** Info · **Confidence:** Needs verification
- **Location:** `src/lib/action.ts:31`, `src/lib/approvals/guard.ts:59`, `src/actions/auth.ts:75` (`console.error(e)`)
- **Evidence:** Database errors from drizzle can include the query and its parameters (emails, names) in the message, which then goes to Vercel's logs.
- **Risk:** Personal data in logs that more people can read, kept longer than needed.
- **Fix:** Log the error code and a short message, not the full error object.
- **Effort:** S
- **User impact:** No.

### I-2 — Invite links fall back to the request's Host header
- **Severity:** Info · **Confidence:** Confirmed (code), low risk on Vercel
- **Location:** `src/lib/invites.ts:35-41` (`siteBase`)
- **Evidence:** When `APP_BASE_URL` is not set, the sign-in address in invitation emails comes from `x-forwarded-host`/`host`. `APP_BASE_URL` is now set in Vercel (per the owner), which removes this.
- **Risk:** On hosts that pass a spoofed Host header, emails could point to another site. Vercel only routes its own domains.
- **Fix:** Require `APP_BASE_URL` in production (fail clearly if missing).
- **Effort:** S
- **User impact:** No.

---

## D. Manual checks (could not be verified from the code)

- [ ] **AUTH_SECRET is long and random.** Vercel → Project → Settings → Environment Variables → `AUTH_SECRET`: confirm it is at least 32 random characters, not a word or a reused value. If unsure, replace it with the output of `openssl rand -base64 48`; everyone will need to sign in again.
- [ ] **Support Admin password is strong.** Check that `SUPPORT_ADMIN_PASSWORD` (or `HEAD_ADMIN_PASSWORD`) is at least 16 characters, unique, and known only to its owner. Remove whichever of the two prefixes is not used.
- [ ] **Secrets are scoped to Production.** For `DATABASE_URL`, `AUTH_SECRET`, `SUPPORT_ADMIN_*` and `SMTP_PASS`, check which environments are ticked. Preview deployments should not use the production database or password.
- [ ] **Preview deployments are protected.** Vercel → Settings → Deployment Protection: turn on Vercel Authentication for Preview deployments, so preview URLs are not open to the public.
- [ ] **`DB_DRIVER` is not `pg`** in Vercel (see L-8). If it is unset, the secure Neon driver is used.
- [ ] **Vercel team access.** Vercel → Team → Members: only people who need it; each has MFA on their Vercel account.
- [ ] **Neon access.** Neon console → Settings → Members: only needed people, each with MFA. Check that the database role in `DATABASE_URL` is not shared with other projects.
- [ ] **Neon IP allow list** (if your plan has it): Neon → Project → Settings → IP Allow. Consider allowing only Vercel's egress, or leave off and rely on the strong password. Note the connection string is the only lock otherwise.
- [ ] **Backups / point-in-time restore.** Neon → Project → Settings → Storage/History retention: confirm how many days of history are kept (restore window). Test restoring the "Backup Branch" once.
- [ ] **Neon "Backup Branch" credentials.** Check that branch has its own password and is not used by any public deployment.
- [ ] **Zoho.** Zoho Mail → Security → App Passwords: the App Hub uses a dedicated app password (revocable). Confirm MFA is on for the aistudio@mcciapune.com mailbox.
- [ ] **GitHub repository is private** and branch protection is on for `main`; Dependabot alerts enabled (Settings → Code security).
- [ ] **Vercel Firewall / WAF.** Vercel → Firewall: consider a rate-limit rule on `POST /login` (also helps H-1) and enabling Bot protection.
- [ ] **Log retention.** Vercel → Logs: know how long runtime logs are kept, and who can read them (I-1).
- [ ] **Secrets in git history.** No secrets were found by pattern search in tracked files or history (gitleaks/trufflehog were not installed). For certainty run: `brew install gitleaks && gitleaks git .` in the repository.
- [ ] **Old orphan uploads.** In the Neon SQL editor: `select count(*), pg_size_pretty(sum(size)) from apr_files where attached = false;` to see how much M-5 has already accumulated.

There is no server, Docker, SSH, security group or firewall to check: the app runs on Vercel's managed platform and the database is Neon's managed service.

---

## E. What is already done well

- **Passwords:** scrypt with a random salt (`src/lib/passwords.ts`), constant-time comparison, a dummy check for unknown emails so timing doesn't reveal which accounts exist, and minimum length and complexity.
- **Sessions:** HMAC-signed, HttpOnly, SameSite=Lax, Secure in production, 8-hour expiry. A password change or deactivation invalidates existing sign-ins (password fingerprint in the token).
- **Administrator re-authentication:** Administrator requires the password again, locks after 30 minutes idle, and locks when you leave it.
- **Authorization:** every server action goes through `adminAction` / `staffAction` with per-target rules in one place (`src/lib/rbac.ts`), and approval routes through `route()`. Request visibility and file downloads are filtered by who may see them (`visibility()`, `canSeeRequest`), returning "not found" rather than "forbidden". Decisions check the current approver and block self-approval.
- **CSRF:** Server Actions have Next.js's origin check; API writes check the Origin header (`sameOrigin`), and cookies are SameSite=Lax.
- **Injection:** all SQL is parameterised through drizzle (`sql\`\`` templates; no `sql.raw`). LIKE patterns are escaped. CSV exports neutralise formula cells.
- **XSS:** React escaping throughout; email HTML is escaped (`escapeHtml`).
- **Uploads:** an allow-list of extensions, a 10 MB limit, MIME decided from the extension, stored in the database (not a public bucket), `nosniff`, downloads only for people who may see the request, and each upload is tied to its uploader and usable once.
- **SSRF:** the link check accepts only https, refuses private and metadata addresses, and checks every redirect.
- **Open redirect:** `safeNext` allows only same-site paths after sign-in.
- **Transport:** HTTPS enforced with an http→https redirect, HSTS with preload, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.
- **Audit:** admin changes, access changes, role changes and password events are recorded with names copied in, and never include passwords or tokens.
- **Secrets:** `.env*` is git-ignored; only `.env.example` (empty values) is tracked; no secrets were found in tracked files or history; no `NEXT_PUBLIC_` secrets.

---

## F. Fix plan

**Fix immediately**
1. H-2: upgrade Next.js to the latest 16.x.
2. M-2, L-1: `npm audit fix` (zod, nodemailer).
3. H-1 + M-1: record every sign-in attempt and limit failures (login, unlock, change password).

**Fix this week**
4. M-5: daily cleanup of abandoned uploads.
5. L-4: block APIs and actions while on a temporary password.
6. L-3: require the Administrator unlock for Approval System admin writes.
7. L-6: hide `X-Powered-By`, add Permissions-Policy.
8. M-4: add a CSP in Report-Only mode, then enforce.
9. Section D manual checks (AUTH_SECRET, Preview protection, Neon backups).

**Fix later**
10. M-3: authenticator-app codes for the Support Admin and Admins.
11. L-2: server-side session revocation ("sign out everywhere").
12. L-5: stop sending all staff emails to the expense form (after confirming the UI change with you).
13. L-7, L-8, I-1, I-2: hardening.

---

## Fix status

| ID | Status |
|---|---|
| All | Pending (Phase 1: audit only) |
