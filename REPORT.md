# MCCIA App Hub: application report

Status as of 3 October 2026. Live at https://mccia-apphub.vercel.app

## 1. What it is

One front door for MCCIA's web applications. Staff open the hub, pick a department in the left menu and click an application card to launch it. The hub stores each application's link and logs every launch; it does not host the applications. The administrator manages departments, applications and users from the **Administrator** section, so nothing needs a redeploy.

**There is no login.** Everyone who opens the link acts as the head admin (`aistudio@mcciapune.com`). See section 7.

## 2. At a glance

| | |
|---|---|
| Hosting | Vercel (functions in Washington DC, `iad1`) |
| Database | Neon Postgres, Ohio (`us-east-2`) |
| Stack | Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Drizzle ORM, Zod |
| Size | 61 source files, about 3,000 lines; 19 commits since 1 Oct 2026 |
| Runtime dependencies | 9 (`next`, `react`, `react-dom`, `drizzle-orm`, `@neondatabase/serverless`, `pg`, `lucide-react`, `zod`, `server-only`) |
| Known vulnerabilities | 0 (`npm audit`, production dependencies) |

## 3. What people see (the hub)

- A left menu with the active departments, and a card for each active application in the selected department.
- Search across all applications.
- Clicking a card goes through `/go/<id>`, which records the launch and redirects to the application's address. Unknown, inactive or malformed ids return 404.
- A phone layout: the menu slides in from a button.

## 4. What the administrator can do

The **Administrator** menu item expands into three sections. Access and Activity log are tabs on the same pages.

- **Departments:** list, add (new ones go to the end), rename, change icon, reorder, activate or deactivate. Open a department for two tabs:
  - **Applications:** add, edit, reorder, activate or deactivate. Applications belong to exactly one department. The form has an **Active** checkbox and validates the address (https only).
  - **Users:** the people whose home department it is, with the applications they can open there.
- **Users:** a read-only table of every user and the applications they can open, with search and a department filter. People are created only by **Bulk import (CSV)**: columns `name, email, department, applications, designation`. Existing emails are skipped; unknown departments, unknown applications, wrong email domains and blank names are reported per row.
- **Notifications Panel:** a placeholder page.
- **Access:** per-user checklists, per-application user lists, bulk assignment (add, remove, replace) and reusable templates.
- **Activity log:** launches with filters, per-app and per-department counts, and a CSV export.

## 5. How it is built

- Pages render on the server and read the database directly. Changes go through server actions, which validate their input with Zod.
- Tables in use: `departments`, `apps`, `users`, `user_app_access`, `access_templates`, `access_template_apps`, `activity_log`.
- Nothing is hard-deleted from the interface: departments, applications and users are deactivated, so the activity history stays intact.
- The only environment variables the app reads are `DATABASE_URL`, `DB_DRIVER`, `DATABASE_SSL`, `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_NAME` and `ALLOWED_EMAIL_DOMAIN` (optional).

## 6. Data today

6 departments (Finance 3 applications, CRM 3, Creative 3, Inventory 2, Safety Week 0, Approval System 0), 11 applications of which 10 are active, 1 user (the head admin) and 5 recorded launches. 68 old login entries remain in the activity log from before the login was removed.

## 7. Security: read this

- **Anyone with the link can do everything.** They can see and edit every application link, create or deactivate users, and read the activity log. Per-user access rules are stored but not enforced, because nobody signs in.
- **Recommended before sharing the link widely:** turn on Vercel Deployment Protection (Settings, Deployment Protection) so only your Vercel team can open the site, or add a login back.
- What is protected regardless: security headers (frame denial, no content sniffing, referrer policy); application addresses must be `https://`; names containing HTML are shown as text and never run; CSV exports neutralise spreadsheet-formula cells; every identifier in an address is validated.
- **Stale secrets on Vercel:** `TEST_LOGIN_USER`, `TEST_LOGIN_PASSWORD`, `HEAD_ADMIN_TEMP_PASSWORD`, `AUTH_SECRET` and `AUTH_URL` are no longer read by anything. Delete them.

## 8. Quality

| Check | Result |
|---|---|
| Typecheck, lint, unused-code scan, production build | all clean |
| Unit tests (`npm run test:unit`) | 18 of 18 |
| End-to-end tests on the live site (`npm run test:e2e`) | 118 of 118 in Chrome and 118 of 118 in WebKit (Safari's engine) |
| Firefox | not run: the browser would not start on the test machine |

The end-to-end suite covers the hub, department and application management (including bad input), CSV import edge cases, access templates, bulk assignment, the per-application editor, the icon pickers, the activity export and a phone-sized screen. It creates test data and removes it, and it checks that real data is unchanged.

Bugs found and fixed while testing: new departments appeared at the top of the menu; an inactive application could not be switched on from its edit form; the sidebar reused one element id twice; the Activity page showed login-based figures that no longer meant anything.

## 9. Performance

- Home page response measured at about 0.3 seconds from the test machine.
- The biggest delay for users is distance: functions and database are in the USA and staff are in India, so every page load makes a long round trip. The login page, which does no database work, took 0.7 to 1.3 seconds from India.
- Neon's free plan sleeps the database after inactivity, so the first visit after a quiet period can be a few seconds slower.

## 10. Known limitations

- A made-up department id shows "Page not found" but returns HTTP 200 (a Next.js streaming behaviour). Only search engines would notice.
- Activity "user" is always the head admin, since nobody signs in.
- Notifications Panel has no content yet.
- The database still contains columns and tables the code no longer uses: `password_hash`, `must_change_password`, `status`, `signup_source`, `reviewed_at`, `reviewed_by_id`, `last_login_at`, and the tables `login_attempts` (86 rows) and `user_department_access`. They are harmless.
- Users cannot be added or edited one at a time, only by CSV.

## 11. Recommendations, in order

1. Protect the site (Deployment Protection, or a login) before sharing it.
2. Delete the stale Vercel variables listed in section 7.
3. Move the database and functions near India: a Neon project in Singapore (`aws-ap-southeast-1`) and the Vercel `sin1` region. This is the main speed improvement available.
4. Decide what Notifications should show, and build it.
5. Drop the unused database columns and tables once you are sure the login will not return.

## 12. Operating it

- Run locally: `npm install`, fill `.env` from `.env.example`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`.
- Deploy: `npx vercel deploy --prod` (a `.vercelignore` keeps uploads small).
- Check code: `npm run typecheck`, `npm run lint`, `npm run clean:scan` (reports unused code; `npm run clean:fix` removes it safely).
- Test: `npm run test:unit`; `E2E_BASE_URL=<site> E2E_BROWSER=chromium npm run test:e2e` (writes and then removes `ZZ` test data in the database the site uses).
- Backup: there is no `pg_dump` on the development machine, so a JSON export of every table can be made with a short script; one was taken before the last database cleanup and is in `backups/` (git-ignored).
