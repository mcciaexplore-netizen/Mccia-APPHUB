# MCCIA App Hub: application report

Status as of 3 October 2026. Live at https://mccia-apphub.vercel.app

## 1. What it is

One front door for MCCIA's web applications. Staff sign in, pick a department in the left menu and click an application card to launch it. The hub stores each application's link and logs every launch; it does not host the applications. The administrator manages departments, applications, people and who can see what from the **Administrator** section, so nothing needs a redeploy.

## 2. At a glance

| | |
|---|---|
| Hosting | Vercel (functions in Washington DC, `iad1`) |
| Database | Neon Postgres, Ohio (`us-east-2`) |
| Stack | Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Drizzle ORM, Zod |
| Size | 71 source files, about 3,700 lines; 21 commits since 1 Oct 2026 |
| Runtime dependencies | 9 (`next`, `react`, `react-dom`, `drizzle-orm`, `@neondatabase/serverless`, `pg`, `lucide-react`, `zod`, `server-only`). Sign-in uses Node's built-in `crypto`, so there is no auth library. |
| Known vulnerabilities | 0 (`npm audit`, production dependencies) |

## 3. Signing in

- **The main admin** is `engineer@mcciapune.com`. Its password is the `HEAD_ADMIN_PASSWORD` environment setting; it is never stored in the database. The first sign-in creates its account.
- **Everyone else** is created by the admin, one at a time or from a CSV. The username is the email address; the password is chosen by the admin (a generator is provided) and stored only as a scrypt hash. People can change their own password from the menu in the top-right corner.
- **Everything is behind the login** except `/login`, including the launch links. The login lasts 8 hours and is a signed, HttpOnly, SameSite=Lax cookie (Secure on the live site). The account is re-read from the database on every request, so deactivating someone, or changing their password, signs them out immediately.
- **No lockouts.** A wrong password just fails and can be retried at once.
- **Administrator is locked separately.** Opening it asks for the password again. It stays unlocked while in use (up to 30 idle minutes), locks again when you move to the hub or load any page outside Administrator, and locks when the browser closes. The unlock cookie belongs to the person who entered the password.
- **Two layers of checking.** `src/proxy.ts` is the gate in front of the whole site; every page, server action and download route also checks for itself, because Next.js documents that a proxy alone must not be relied on.

## 4. What people see

- **A normal user:** only the departments and applications assigned to them. Launching an application they were not given returns 404. They cannot open Administrator.
- **The admin:** every department and application, plus Administrator.
- Clicking a card goes through `/go/<id>`, which records the launch and redirects to the application's address. Unknown, inactive or malformed ids return 404.
- A phone layout: the menu slides in from a button.

## 5. What the administrator can do

- **Departments:** list, add (new ones go to the end), rename, change icon, reorder, activate or deactivate. Open a department for two tabs:
  - **Applications:** add, edit, reorder, activate or deactivate, or delete. Applications belong to exactly one department. The form validates the address (https only) and has an **Active** checkbox.
  - **Users:** the people whose home department it is, with the applications they can open there.
- **Users:** everyone who can sign in, with department, role and applications; search and a department filter. **Add user**, **Reset password**, the Active toggle, **Delete**, and **Bulk import (CSV)** with columns `name, email, password` (required) and `department, applications, designation`. Existing emails are skipped; unknown departments or applications, wrong email domains, blank names and weak or missing passwords are reported per row. The main admin's row cannot be reset or deactivated here.
- **Access:** per-user checklists, per-application user lists, bulk assignment (add, remove, replace) and reusable templates.
- **Activity log:** launches (and the old sign-ins) with filters, per-app and per-department counts, and a CSV export that neutralises spreadsheet-formula cells.
- **Notifications Panel:** a placeholder page.

## 6. How it is built

- Pages render on the server and read the database directly. Changes go through server actions that validate their input with Zod; every admin action calls one shared check (head admin, Administrator unlocked).
- Tables in use: `departments`, `apps`, `users`, `user_app_access`, `access_templates`, `access_template_apps`, `activity_log`.
- Departments are only deactivated. Applications and users can be deactivated (reversible) or deleted for good after a confirmation; the activity log keeps its rows either way (shown as a deleted application or an unknown user). The main admin, your own account and the last head admin cannot be deleted.
- Settings the app reads: `DATABASE_URL`, `DB_DRIVER`, `DATABASE_SSL`, `AUTH_SECRET`, `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_NAME`, `HEAD_ADMIN_PASSWORD` and (optional) `ALLOWED_EMAIL_DOMAIN`.

## 7. Data today

6 departments (Finance 3 applications, CRM 3, Creative 3, Inventory 2, Safety Week 0, Approval System 0), 11 applications of which 10 are active, 2 user accounts (the main admin and the older `aistudio@mcciapune.com`), 5 recorded launches, and 68 old sign-in entries from before the login was removed.

## 8. Security

What is in place: signed, tamper-proof cookies (a forged cookie is rejected); passwords hashed with scrypt and compared in constant time; the same message for a wrong password and an unknown email; sign-out everywhere on a password reset or change; open-redirect protection on the post-login address; security headers (frame denial, no content sniffing, referrer policy); application addresses must be `https://`; names containing HTML are shown as text and never run; CSV exports neutralise formula cells; identifiers in addresses are validated.

What to know:
- **Unlimited password guesses.** As requested, nothing blocks repeated wrong passwords. Each guess costs the server a little time, but a patient attacker is not stopped, so the main admin's password should be long and random (16 characters or more).
- **The old `aistudio@mcciapune.com` account** still exists as a head admin but cannot sign in (its stored password is from the earlier system). Deactivate it from the Users page if it is not needed.
- **Unused settings on Vercel:** `TEST_LOGIN_USER`, `TEST_LOGIN_PASSWORD`, `HEAD_ADMIN_TEMP_PASSWORD` and `AUTH_URL` are read by nothing. Delete them.

## 9. Quality

| Check | Result |
|---|---|
| Typecheck, lint, unused-code scan, production build | all clean |
| Unit tests (`npm run test:unit`) | 18 of 18 |
| End-to-end tests on the live site (`npm run test:e2e`), Chrome | 186 of 186 |
| End-to-end tests on the live site, WebKit (Safari's engine) | 170 of 170 before the delete feature was added; not rerun since |
| Firefox | not run: the browser would not start on the test machine |

The suite signs in as the main admin and covers the login gate, wrong passwords (including many in a row), forged cookies, creating, importing and deleting people and applications, signing in as a normal user and seeing only their applications, deactivation, password reset and change, the Administrator lock, department and application management with bad input, CSV edge cases, access templates, bulk assignment, the per-application editor, the icon pickers, the activity export and a phone-sized screen. It creates test data and removes it, retries when the connection drops, and checks that real data is unchanged.

Bugs found and fixed while testing: new departments appeared at the top of the menu; an inactive application could not be switched on from its edit form; the sidebar reused one element id twice; the activity page showed login-based figures that had stopped meaning anything; a background router fetch was re-locking Administrator right after it was unlocked; the CSV export checked only that someone was signed in (it now checks for head admin with Administrator unlocked).

## 10. Performance

- Home page responds in about 0.4 seconds on the live site.
- The biggest delay for users is distance: functions and database are in the USA and staff are in India, so every page load makes a long round trip.
- Neon's free plan sleeps the database after inactivity, so the first visit after a quiet period can be a few seconds slower.

## 11. Known limitations

- A made-up department id shows "Page not found" but returns HTTP 200 (a Next.js streaming behaviour). Only search engines would notice.
- The bulk import reads CSV only. From Excel, use File, Save As, CSV.
- Notifications Panel has no content yet.
- The database still has columns and a table the code no longer uses (`login_attempts`, `user_department_access`, `signup_source` and a few review fields). They are harmless.
- The Administrator lock cannot detect a closed tab while the browser stays open; it then locks after 30 idle minutes.

## 12. Recommendations, in order

1. Delete the stale Vercel settings listed in section 8, and deactivate the old `aistudio` account if it is not needed.
2. Keep the main admin's password long and random.
3. Move the database and functions near India: a Neon project in Singapore (`aws-ap-southeast-1`) and the Vercel `sin1` region. This is the main speed improvement available.
4. Decide what Notifications should show, and build it.
5. Optionally add `.xlsx` import and an email step that sends new people their sign-in details.

## 13. Operating it

- Run locally: `npm install`, fill `.env` from `.env.example` (including `AUTH_SECRET`, from `openssl rand -base64 32`), `npm run db:migrate`, `npm run db:seed`, `npm run dev`.
- Deploy: `npx vercel deploy --prod` (a `.vercelignore` keeps uploads small). Changing a Vercel setting needs a redeploy.
- Check code: `npm run typecheck`, `npm run lint`, `npm run clean:scan` (reports unused code; `npm run clean:fix` removes it safely).
- Test: `npm run test:unit`; `E2E_BASE_URL=<site> E2E_BROWSER=chromium npm run test:e2e` (needs `HEAD_ADMIN_EMAIL` and `HEAD_ADMIN_PASSWORD` in `.env`; writes and removes `ZZ` test data in the database the site uses).
- Backup: there is no `pg_dump` on the development machine; a JSON export of every table can be made with a short script (one was taken before the last database cleanup, in `backups/`, git-ignored).
