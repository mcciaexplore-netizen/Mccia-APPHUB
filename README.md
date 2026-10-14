# MCCIA App Hub

One front office for every MCCIA web app. Pick a department in the sidebar and open its applications, shown as square cards. The hub stores links and logs launches. It does not host the apps. Everything is managed from **Administrator**, so adding a department, app or user never needs a redeploy.

**Sign-in.** Everything is behind a login. The main admin (`HEAD_ADMIN_EMAIL`) signs in with `HEAD_ADMIN_PASSWORD` from the environment; the admin then creates everyone else (one by one or from a CSV) with a username (their email) and a password, and decides which applications each person sees. Administrator asks for the password again and locks itself the moment you leave it.

Stack: Next.js 16 (App Router, TypeScript), Tailwind CSS v4, Postgres + Drizzle ORM, lucide-react, zod.

All commands below are PowerShell.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local     # then fill it in
npx drizzle-kit migrate               # or: npm run db:migrate
npx tsx scripts/seed.ts               # or: npm run db:seed (safe to re-run)
npm run dev
```

Environment variables (see `.env.example`): `DATABASE_URL`, `DB_DRIVER` (`neon` or `pg`), `DATABASE_SSL`, `AUTH_SECRET` (signs the login cookie; `openssl rand -base64 32`), `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_NAME`, `HEAD_ADMIN_PASSWORD` (at least 10 characters, a letter and a number), and optionally `ALLOWED_EMAIL_DOMAIN` (comma-separated domains users may have; empty means any).

The seed only creates the head admin named in the environment. Departments, apps and users are all added from Administrator.

Useful scripts: `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run typecheck`, `npm run lint`, `npm run build`.

### Tests

```powershell
npm run test:unit                                            # fast: CSV parsing/export and the email-domain rule
$env:E2E_BASE_URL="http://localhost:3000"; npm run test:e2e  # the whole app in a real browser
```

`test:e2e` needs `E2E_BASE_URL` (it will not guess) and optionally `E2E_BROWSER` = `chromium` (default, uses installed Chrome), `firefox` or `webkit` (run `npx playwright-core install firefox webkit` once). It writes test data whose names start with `ZZ` / `zz-` to the database the site uses, removes it afterwards, and checks your real data is unchanged. See `REPORT.md` for the latest results and a full description of the application.

### Finding and removing unused code

```powershell
npm run clean:scan                         # report only: unused files, exports, dependencies, lint warnings, CSS, public files
npm run clean:fix                          # remove unused exports and dependencies
node scripts/cleanup.mjs --fix --files     # also delete unused source files
node scripts/cleanup.mjs --caches          # delete build caches
```

`clean:fix` refuses to run with uncommitted changes, then re-runs typecheck, lint and the build, and reverts everything by itself if one of them fails. Review the result with `git diff`. Unused CSS classes and `public/` files are only reported, because a scan cannot be sure nothing builds those names from a string.

## Deployment (Vercel + Neon)

1. Create the Neon project and copy the **pooled** connection string into `DATABASE_URL`.
2. Apply migrations: `npx drizzle-kit migrate`. Never use `push` on production.
3. Seed: `npx tsx scripts/seed.ts` with `HEAD_ADMIN_EMAIL` and `HEAD_ADMIN_NAME` set (the first sign-in also creates the admin row).
4. Push to GitHub, import the repo in Vercel, add `DATABASE_URL`, `AUTH_SECRET`, `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_NAME`, `HEAD_ADMIN_PASSWORD` (and `ALLOWED_EMAIL_DOMAIN` if you use it), deploy.
5. Open the site, go to Administrator, and replace the sample data with real departments, apps and users.

## Access model

- **Login is required for everything** except `/login`. A signed cookie (HMAC with `AUTH_SECRET`, 8 hours) names the person; their account is re-read from the database on every request, so deactivating someone or changing their password takes effect immediately. A wrong password just fails and can be retried at once; nothing is ever locked or blocked.
- **Administrator is locked separately.** Opening it asks for the password again (the unlock lasts while it is in use, up to 30 idle minutes, and is a session cookie). Moving to the hub, or loading any page outside Administrator, locks it again. Every server action and route re-checks this itself; the gate in `src/proxy.ts` is only the first line.
- **Departments contain apps; every app belongs to exactly one department.** Access is granted per user per app (table `user_app_access`), never per department. A user can hold apps from several departments.
- **Roles:** `head_admin` sees every app and is the only role that can open Administrator. `member` ("User") sees only the apps assigned to them. `dept_lead` ("Department admin") exists in the schema for later; there is no UI to create it and it has no extra powers beyond a read-only Activity page for its home department.
- **The sidebar** lists only departments where the user has at least one app. App URLs are never sent to the browser in lists; every card opens `/go/[appId]`, which re-checks access on the server, logs the launch, and redirects. Without access it returns 404.
- **Administrator** (head admin only) is a sidebar item that opens three sections: **Departments**, **Users** and **Notifications Panel** (a placeholder for now). Access and Activity log stay reachable from the tabs at the top of every Administrator page.
- **Departments:** the list shows every department; open one to see its **Applications** tab (with *Add application*, which adds to that department only) and its **Users** tab (people whose home department it is, with the applications they can open there).
- **Users:** everyone who can sign in, with their department and the applications they can open. **Add user** creates one account (email as the username, plus a password you can generate); **Reset password** and the Active toggle manage existing ones; the main admin's password lives in the environment, so it cannot be reset or deactivated here. **Bulk import (CSV)** takes `name, email, password` (required) and `department, applications, designation`. Passwords are stored as scrypt hashes, never in plain text. People can change their own password from the menu in the top-right corner.
- **Bulk import (CSV):** columns `name`, `email` (required) and `department`, `applications`, `designation` (optional). Put several applications in one quoted cell separated by commas, for example `"Tally, CRM"`. An application is looked up in the user's own department first; write `Department / App` when the same name exists in several. Departments and applications must exist first. Existing emails are skipped, never changed. A template can be downloaded from the panel.
- **Accounts:** the username is the email address. Users see only the applications assigned to them (Access page); the admin sees everything.
- **Deactivate or delete.** Users, applications and departments can be deactivated (reversible; a deactivated person is signed out at once). Applications and users can also be deleted for good from Administrator, after a confirmation: a deleted application drops out of everyone's access and of every template; a deleted user loses their account, password and access. In both cases the activity log keeps its rows, shown as a deleted application or an unknown user. The main admin, your own account and the last head admin cannot be deleted. Departments are only deactivated.
- **Access management** (Administrator → Access): a per-user checklist tree (ticking a department ticks all its apps), a per-app user list with bulk add/remove, bulk assignment to many users, and reusable templates that are copied onto users and can then be customised.
- **Activity:** `activity_log` records `launch` actions (earlier `login` entries are kept) with user, app, IP and time. Administrator → Activity shows the log, launches per app and department, active users this week, users who never launched an app, last login per user, and CSV export.
- **`app_token`** on each app is reserved for a future single sign-on handoff (a signed JWT passed to the child app). It is stored and shown to the head admin only; nothing uses it yet.

> **Also in this repository:** `approvals-app/` is a separate, standalone approvals application (React + Tailwind, Express, SQLite) for expenditure, DG approvals, HR, reimbursement and events. It has its own `package.json`, is not part of the hub's build, and is ignored by the hub's lint and Vercel upload. See `approvals-app/README.md`.

## Approvals module (`/approvals`)

HR and expenditure approvals (a replica of the Zoho "DG Approval" and "Expenditure" apps), built into the hub (a sidebar item, not an application card). It lives in `src/lib/approvals/`, `src/components/approvals/`, `src/app/approvals/` and `src/app/api/approvals/`, and its tables are all prefixed `apr_` (schema in `src/db/approvals-schema.ts`; migrations `0006_approvals_foundation.sql` and `0007_approvals_requests.sql`, both additive only). It is separate from the hub's own parameters and functions: it reads the hub's session and user list only through `src/lib/approvals/host-adapter.ts`.

**What it does**

- Three request forms: **HR**, **Expenditure** (₹10,000 and above, approved by the DG) and **Expenses** (below ₹10,000). Amounts typed into the wrong form are stopped with a link to the right one, with the details carried over. The limit is a setting.
- Budgets per branch, category and financial year (April to March). A request shows the budget live; going over (or having no budget) never blocks submission but flags the request "Over budget", and the approver must write a comment to approve it. Only **approved** requests use up budget.
- Approval: a request goes to the approvers named in **Approver Rules**, in order. A step with nobody named is skipped, so leaving "Reviewer" empty makes the DG the only approver. Nobody can approve their own request, and if two people click at once only the first decision counts. Everything that happens is recorded in the request's timeline.
- Lists (search, date range, category, branch, status, sorting, paging, CSV export), the DG's inbox with quick Approve/Reject, reports (HR report, approval time, budget utilisation) and a notification bell. Each person only ever sees their own requests and the ones routed to them; viewers, admins and the DG see everything.
- Attachments (PDF, JPG, PNG, Word, Excel, up to 10 MB each) are stored in Postgres and only served through a route that checks who may see the request.
- Two sidebar parts, **DG Approval** and **Expenditure**, switched at the top of the sidebar.

**Turn it on (PowerShell):**

```powershell
# 1. Nothing to switch on: Approvals is on by default (APPROVALS_ENABLED=false turns it off)
npx drizzle-kit migrate               # adds the apr_ tables (0006 and 0007); nothing existing is touched
npm run db:seed:approvals             # 40 expense categories, 6 HR categories, settings, 5 routing rules (safe to re-run)
npm run dev
```

**Where it is in the hub.** Approvals is a feature of the hub, not an application in a department. It is a built-in **Approval System** item in the hub's sidebar (next to Administrator); one click opens it, with the login the person is already using. There is no separate sign-in, no card to click and nothing to tick for each person: everyone who can sign in to the hub can open it, and what they can do inside comes from their roles (below). Approvals is on by default; `APPROVALS_ENABLED=false` turns it off and removes the item. If you added an "Approvals" application (URL `/approvals`) in a department earlier, it is no longer listed or launchable, and a department that holds nothing else disappears from the sidebar; you can delete both under Administrator → Departments.

**Who approves.** In Approvals → Approver Rules, name one person per step: the DG for HR and for expenditure of ₹10,000 and above, and the below-₹10,000 approver for Expenses. Those people become approvers automatically. (`APPROVALS_HR_APPROVER_EMAIL`, `APPROVALS_EXPENDITURE_APPROVER_EMAIL` and `APPROVALS_DG_EMAIL` only pre-fill the rules when the seed runs; the people must already be users in the hub.) Branches and budgets are entered by an Approvals admin; the Name lists on the forms come from the hub's users.

**Who can do what.** Everyone signed in to the hub is a requester. The hub's head admin is an Approvals admin automatically, and an Approvals admin can make others Approvals admins or viewers (Approvals → Roles and Access). Approvers and the DG are not granted: a person is an approver when named on step 1 of a routing rule, and the DG when named on a later step.

**Email.** Set `SMTP_HOST`, `SMTP_FROM` (and `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `APP_BASE_URL`) to send email as well as the in-app notifications. Without them nothing is emailed and nothing breaks. Email can be turned off per kind in Approvals → Settings.

**Switching it off.** `APPROVALS_ENABLED=false` (also `0`, `off`, `no`): every `/approvals` page and `/api/approvals` route returns 404, and the hub hides the Approval System item. Unset, empty or anything else means on.

**Money and dates.** Money is stored as integer paise and shown with Indian grouping (12,34,567.00). Dates are stored in UTC and shown as dd-MMM-yyyy in Asia/Kolkata. The financial year runs April to March, judged in IST. Request numbers restart each financial year: `HR-2026-27-0001`, `EXP-2026-27-0001` (₹10,000 and above), `EXB-2026-27-0001` (below).

**Tests.** `npm run test:unit` covers the rules (budget maths, routing, validation, dates). `npm run test:e2e:approvals` (module set-up and admin screens) and `npm run test:e2e:approvals:flow` (submit, approve, reject, budgets, files) drive a real browser against a running server; see the header of each file.

## Database portability

- Plain Postgres only, no Neon-specific features. Portable column types; uuids come from `gen_random_uuid()` (Postgres 13+, no extension).
- All DB access goes through `src/db/index.ts`. `DB_DRIVER=neon` uses `drizzle-orm/neon-http`; `DB_DRIVER=pg` uses `drizzle-orm/node-postgres` with a `pg` Pool (max 5, SSL via `DATABASE_SSL`).
- Migrations live in `drizzle/` and are committed. Generate with `npx drizzle-kit generate`, apply with `npx drizzle-kit migrate`.
- Timestamps are `timestamptz` (UTC) and are shown in Asia/Kolkata in the UI.
- The `neon-http` driver has no interactive transactions, so the app never uses `db.transaction()`. Keep it that way to stay driver-agnostic.

### Backup and restore

```powershell
$env:DATABASE_URL = "postgres://..."
.\scripts\backup.ps1                 # full dump to backups\mccia-hub-<timestamp>.sql
.\scripts\backup.ps1 -DataOnly       # data only (for a target that already has migrations)
$env:DATABASE_URL = "postgres://target..."
.\scripts\restore.ps1 -File backups\mccia-hub-<timestamp>.sql
```

Requires `pg_dump` and `psql` (PostgreSQL client tools) on PATH.

### Moving from Neon to our own server

1. Install Postgres 15 or newer on the server and enable SSL.
2. Create the database and a dedicated user.
3. Run the migrations against the new database: `$env:DATABASE_URL="<new url>"; npx drizzle-kit migrate`
4. `pg_dump` the data from Neon and restore it on the new server: run `.\scripts\backup.ps1 -DataOnly` with the Neon URL, then `.\scripts\restore.ps1 -File <dump>` with the new URL.
5. In Vercel set `DB_DRIVER=pg`, `DATABASE_URL` and `DATABASE_SSL`.
6. Redeploy and verify (open the hub, open an app, check the activity log).
7. Keep Neon read-only for a week, then delete it.

If the app stays on Vercel, the new database server must be reachable from the internet over SSL, with firewall rules restricted where possible. If the app later moves onto the same server, no public database access is needed.

## Theme

MCCIA Applied AI Studio tokens live in `src/app/globals.css`. Tailwind v4 has no `tailwind.config`; tokens are CSS variables exposed through `@theme` (colors like `text-primary`, `bg-blue-tint`, radii, shadows, fonts, animations) plus component classes (`.glass`, `.btn`, `.input`, `.badge`, `.table-wrap`, `.alert`). Components contain no hardcoded hex values. `prefers-reduced-motion` disables all animation, including the canvas grid and the counters.

## Decisions where the brief was open

- Applications and users can be deleted (with history kept); departments are only deactivated.
- CSV export is head admin only. Cells that start with `= + - @` are prefixed with an apostrophe to prevent spreadsheet formula injection.
- Non-admins visiting `/administrator` are redirected to `/`. Because the page streams behind a loading skeleton, the redirect arrives as a streamed redirect (HTTP 200 with a redirect instruction) rather than a 307, and no Administrator data is included in the response.
- App icons are picked from the built-in icon set (no image upload), because the serverless host has no persistent file storage.
- The last-admin check reads then writes without a transaction (see the neon-http note), so two admins demoting each other in the same instant could race. Negligible for this use.

## Future work: SSO for the linked apps

Each linked app keeps its own login for now. The `apps.app_token` column is there so a signed-JWT handoff can be added later without a schema change.

## Out of scope

Notifications, comments, chat, and a Department Admin interface.
