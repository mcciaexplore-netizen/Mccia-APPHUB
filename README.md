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

Environment variables (see `.env.example`): `DATABASE_URL`, `DB_DRIVER` (`neon` or `pg`), `AUTH_SECRET` (signs the login cookie; `openssl rand -base64 32`), `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_NAME`, `HEAD_ADMIN_PASSWORD` (at least 10 characters, a letter and a number), and optionally `ALLOWED_EMAIL_DOMAIN` (comma-separated domains users may have; empty means any), `APP_BASE_URL` (the site's address, used in setup links), `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (to email setup links), and `DB_POOL_MAX` (with `DB_DRIVER=pg` only: connections per server process, default 5).

The seed only creates the head admin named in the environment. Departments, apps and users are all added from Administrator.

Useful scripts: `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run typecheck`, `npm run lint`, `npm run build`.

### Tests

```powershell
npm run test:unit                                            # fast: permissions, import parsing, Excel reading, guards, the address-safety rules, CSV, Approvals rules
# against a SCRATCH database (these write to it; INTEGRATION_DATABASE_URL must not be the live one):
$env:INTEGRATION_DB_CONFIRM="yes"; $env:INTEGRATION_DATABASE_URL="postgres://postgres@127.0.0.1:5432/scratch"
npm run test:integration:hub                                 # access changes, team-manager limits, directory, bulk import, setup links, audit, revocation
npm run test:integration                                     # the Approvals module
$env:E2E_BASE_URL="http://localhost:3000"; npm run test:e2e  # the hub in a real browser
npm run test:e2e:people                                      # Users & Access in a real browser
```

Load tests live in `tests/load/` (see `docs/PERFORMANCE.md`): `npm run test:load:seed` fills a scratch database, `npm run test:load` drives real HTTP traffic at 100 to 500 concurrent users, `npm run test:load:write` loads the write paths. They refuse to run against anything but a scratch database or a local server.

`test:e2e` needs `E2E_BASE_URL` (it will not guess) and optionally `E2E_BROWSER` = `chromium` (default, uses installed Chrome), `firefox` or `webkit` (run `npx playwright-core install firefox webkit` once). It writes test data whose names start with `ZZ` / `zz-` (or `ZZP` / `zzp-` for the people suite) to the database the site uses, removes it afterwards, and checks your real data is unchanged. Use a scratch database or a Neon branch, not the live one. See `REPORT.md` for the latest results and a full description of the application.

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
- **Roles:** `head_admin` (the super administrator) sees every app, is the only role that can open Administrator, and is set in the environment, never granted on screen. `dept_lead` is shown as **Team manager**: they see and manage only the plain users in their team or reporting to them, and can give or take away only applications they can open themselves (page **My team**). `member` ("User") sees only the apps assigned to them. Every rule about who may do what to whom is in one file, `src/lib/rbac.ts`, which the screens, the server actions and the directory queries all use.
- **The sidebar** lists only departments where the user has at least one app. Outside applications' URLs are never sent to the browser in lists; their cards open `/go/[appId]`, which re-checks access on the server, logs the launch, and redirects. Without access it returns 404. An application built into the hub (Cab Booking, Inventory: its address is a page of this site) opens in place, without reloading the page, and records the launch in the background (`POST /go/[appId]`, the same checks); its pages check access themselves.
- **One bell everywhere.** The hub's bell (the hub's own notices, Cab Booking's and the Approval System's) is in the top bar of the hub and of every built-in application, and keeps its count current while the page stays open (every minute while the tab is in view; `GET /api/notifications/unread`). The Approval System keeps its own bell as well.
- **Errors stay in their frame.** A page that fails shows a "could not be loaded" panel with Try again inside its own frame (the hub's top bar and the application's menu stay), with the server's reference code for the Support Admin, never the error itself.
- **Administrator** (head admin only) is a sidebar item that opens: **Dashboard** (real counts, what needs attention, recent changes), **Departments**, **Users & Access**, **Applications** (inventory), **Notifications Panel** (a placeholder) and **Activity log**.
- **Departments:** the list shows every department; open one to see its **Applications** tab (with *Add application*, which adds to that department only) and its **Users** tab (people whose home department it is, with the applications they can open there).
- **Users & Access** is one section for everything about people. **People** is a searchable, filterable, sortable, paged directory (server-side, so it stays quick with thousands of people): name, email, role, branch, department, team, reporting manager, applications, status (Active, Inactive, **Pending invitation**) and last sign-in, with filters for branch, department, team, role, status and application. Open a person for their whole configuration on one screen: details, where they sit, application access, account status, recently opened applications and recent changes. Row actions (open, reset password or send a setup link, activate or deactivate with confirmation, delete) and bulk actions (select people, **Assign applications**, send setup links) are in the directory itself. **Branches & teams** manage the organisation (a team can belong to a branch; a branch or team that is still in use cannot be deleted, only deactivated). **Audit log** shows every change.
- **Assigning applications** is one dialog: choose who (the selected people, or everyone in a team, department or branch), what to do (add, remove, or make access exactly these), which applications (the checklist shows how many of the chosen people already have each; a template can pre-fill it), review exactly who gains and loses what, then confirm. A change is **one database statement**: everyone is updated or no one is, so a failure never leaves anyone half-changed and a retry is harmless. Nobody gets applications automatically: a new person has none until they are assigned.
- **Bulk add users** (Users & Access → Bulk add users): upload a **CSV or Excel (.xlsx)** file, or type rows. Columns: `name`, `email` (required), `branch`, `department`, `team`, `reporting_manager` (an email, of an existing person or a row in the same file), `role` (empty = User, or Team manager), `applications` and `designation`. A template with instructions can be downloaded. Every row is checked against the real data before anything is created and classed as **Ready**, **Needs correction** (a near-miss spelling comes with a suggestion), **Invalid**, **Duplicate** (same email twice in the file) or **Already exists**, with the row number and the reason; rows can be corrected on screen. **A file with a password column is refused**: nobody types or shares passwords. Each new person gets a one-time setup link (below). Existing emails are skipped, or (your choice) have department, branch, team, manager and designation updated and applications added; role, password and status are never changed by an import. Running the same file again creates no duplicates. After the run: a results table and a downloadable report (CSV) with row results and reasons only, never a password or a link; failed rows can be retried.
- **Setup links instead of passwords.** A new person (added one by one or in bulk) receives a one-time link to choose their own password. Only a hash of the link's token is stored. A link works once, expires after 72 hours, and sending a new one cancels the old one; it also stops working if the account is deactivated. With mail set up (`SMTP_HOST`, `SMTP_FROM`, and `APP_BASE_URL` for the address in the link) the link is emailed; without it, it is shown once to the administrator to pass on, and is not stored, logged or put in a report. For someone who cannot receive email the administrator can still set a password by hand; it is hashed at once and never recorded.
- **Accounts:** the username is the email address. A person sees only the applications assigned to them; the head admin sees everything.
- **Deactivate or delete.** Users, applications and departments can be deactivated (reversible; a deactivated person is signed out at once). Applications and users can also be deleted for good from Administrator, after a confirmation: a deleted application drops out of everyone's access and of every template; a deleted user loses their account, password and access. In both cases the activity log keeps its rows, shown as a deleted application or an unknown user. The main admin, your own account and the last head admin cannot be deleted. Departments are only deactivated.
- **Access by application and templates** (Administrator → Users & Access → "By application & templates"): a per-app user list with bulk add/remove (also one statement, audited), and reusable templates that pre-fill the assign dialog or a person's checklist. A template is a starting point: it is copied onto people, who can then be customised.
- **Activity:** `activity_log` records `launch` actions (earlier `login` entries are kept) with user, app, IP and time. Administrator → Activity shows the log, launches per app and department, active users this week, users who never launched an app, last login per user, and CSV export.
- **Audit log** (`access_audit`): who changed what, when and to whom, for access, people, roles, branches, teams, templates and applications, with the applications added and removed (and a person's access before and after) in plain names. It can be filtered and exported (head admin). Whatever a caller passes, anything that looks like a password, token, hash or link is dropped before it is stored.
- **Application labels and the inventory.** Each application has an availability label the administrator sets: **Active**, **Under testing** (shown on its card) or **Unavailable** (shown, cannot be opened: the card has no link and `/go/[id]` answers 503; for an application built into the hub, typing its address or calling its API is refused too; the head admin can still open it to test). **Administrator → Applications** lists every application with its identifier, department, address, label, how many people have it and the result of the last link check. **Check** visits the address over https from the server (refusing private and internal addresses, including cloud metadata) and records whether it answered; a passing check shows as **Link verified** for 30 days. That proves the link works, not that the application's own features do, and the hub cannot stop someone who already knows an external application's address from opening it directly: only the application itself (or a future single sign-on handoff) can enforce that.
- **`app_token`** on each app is reserved for a future single sign-on handoff (a signed JWT passed to the child app). It is stored and shown to the head admin only; nothing uses it yet.

> **Also in this repository:** `approvals-app/` is a separate, standalone approvals application (React + Tailwind, Express, SQLite) for expenditure, DG approvals, HR, reimbursement and events. It has its own `package.json`, is not part of the hub's build, and is ignored by the hub's lint and Vercel upload. See `approvals-app/README.md`.

## Approvals module (`/approvals`)

HR and expenditure approvals (a replica of the two Zoho apps, now called **HR Approval** and **Expenditure**), built into the hub (a sidebar dropdown, not an application card), in the hub's own theme. It lives in `src/lib/approvals/`, `src/components/approvals/`, `src/app/approvals/` and `src/app/api/approvals/`, and its tables are all prefixed `apr_` (schema in `src/db/approvals-schema.ts`; migrations `0006_approvals_foundation.sql` and `0007_approvals_requests.sql`, both additive only). It is separate from the hub's own parameters and functions: it reads the hub's session and user list only through `src/lib/approvals/host-adapter.ts`.

**What it does**

- Three request forms: **HR**, **Expenditure** (₹10,000 and above, approved by the DG) and **Expenses** (below ₹10,000). Amounts typed into the wrong form are stopped with a link to the right one, with the details carried over. The limit is a setting.
- The budget is typed by the requester on the form: **Budget Allocated** and **Budget Used**; what is available and what would remain after the request are worked out. Going over never blocks submission but flags the request "Over budget", and the approver must write a comment to approve it. There are no budget pages for the branch to fill in.
- Approval: a request goes to the approvers named in **Approver Rules**, in order. A step with nobody named is skipped, so leaving "Reviewer" empty makes the DG the only approver. Nobody can approve their own request, and if two people click at once only the first decision counts. Everything that happens is recorded in the request's timeline.
- Lists (search, date range, category, branch, status, sorting, paging, CSV export), the DG's inbox with quick Approve/Reject, reports (HR report, approval time) and a notification bell. These are for people with full access (see "Who can do what"); a plain requester has the forms only. Approvers see their own requests and the ones routed to them; viewers, admins and the DG see everything.
- Attachments (PDF, JPG, PNG, Word, Excel, up to 10 MB each) are stored in Postgres and only served through a route that checks who may see the request.
- Two applications under the **Approval System** dropdown in the hub sidebar: **HR Approval** (HR requests, expenditure of ₹10,000 and above, budgets, the DG's inbox, administration) and **Expenditure** (expenses below ₹10,000 and their approvals). Each opens in the main panel, beside the hub sidebar, with its own title, a bell, a row of section tabs and the pages of the chosen section underneath (the same pattern as the Administrator tabs).

**Turn it on (PowerShell):**

```powershell
# 1. Nothing to switch on: Approvals is on by default (APPROVALS_ENABLED=false turns it off)
npx drizzle-kit migrate               # adds the apr_ tables (0006 and 0007); nothing existing is touched
npm run db:seed:approvals             # 40 expense categories, 6 HR categories, settings, 5 routing rules (safe to re-run)
npm run dev
```

**Where it is in the hub.** Approvals is a feature of the hub, not an application in a department. It is a built-in **Approval System** item in the hub's sidebar (next to Administrator). Clicking it drops down **HR Approval** and **Expenditure**; choosing one opens that application in the main panel, with the login the person is already using. (Opening the bare address `/approvals` goes to the Expenses form, or to the inbox for an approver with something waiting.) There is no separate sign-in, no card to click and nothing to tick for each person: everyone who can sign in to the hub can open it, and what they can do inside comes from their roles (below). Approvals is on by default; `APPROVALS_ENABLED=false` turns it off and removes the item. If you added an "Approvals" application (URL `/approvals`) in a department earlier, it is no longer listed or launchable, and a department that holds nothing else disappears from the sidebar; you can delete both under Administrator → Departments.

**Who approves.** In Approvals → Approver Rules, name one person per step: the DG for HR and for expenditure of ₹10,000 and above, and the below-₹10,000 approver for Expenses. Those people become approvers automatically. (`APPROVALS_HR_APPROVER_EMAIL`, `APPROVALS_EXPENDITURE_APPROVER_EMAIL` and `APPROVALS_DG_EMAIL` only pre-fill the rules when the seed runs; the people must already be users in the hub.) Branches and budgets are entered by an Approvals admin; the Name lists on the forms come from the hub's users.

**Who can do what.** Everyone signed in to the hub is a requester, and a requester gets the **forms only**: the HR and Expenditure forms under HR Approval, and the Expenses form under Expenditure. After submitting they see a confirmation with the request number on their own request page, and a notification (the bell, and the email when mail is set up) opens that page when it is decided. Every list, timeline, report, budget, the inbox, the CSV export and all of Setup are closed to them, and answer "not found" if the address is typed. **Full access** (everything in the menu that the person's role allows) goes to anyone holding one of: Approvals admin, viewer, approver, DG (`FULL_ACCESS_ROLES` in `src/lib/approvals/approvals.manifest.ts` is the one place this is decided). The hub's head admin is an Approvals admin automatically, and an Approvals admin can make others Approvals admins or viewers (Approvals → Roles and Access). Approvers and the DG are not granted: a person is an approver when named on step 1 of a routing rule, and the DG when named on a later step.

**Email.** Set `SMTP_HOST`, `SMTP_FROM` (and `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `APP_BASE_URL`) to send email as well as the in-app notifications. Without them nothing is emailed and nothing breaks. Email can be turned off per kind in Approvals → Settings.

**Switching it off.** `APPROVALS_ENABLED=false` (also `0`, `off`, `no`): every `/approvals` page and `/api/approvals` route returns 404, and the hub hides the Approval System item. Unset, empty or anything else means on.

**Money and dates.** Money is stored as integer paise and shown with Indian grouping (12,34,567.00). Dates are stored in UTC and shown as dd-MMM-yyyy in Asia/Kolkata. The financial year runs April to March, judged in IST. Request numbers restart each financial year: `HR-2026-27-0001`, `EXP-2026-27-0001` (₹10,000 and above), `EXB-2026-27-0001` (below).

**Tests.** `npm run test:unit` covers the rules (budget maths, routing, validation, dates). `npm run test:e2e:approvals` (module set-up and admin screens) and `npm run test:e2e:approvals:flow` (submit, approve, reject, the typed budget, files) drive a real browser against a running server; see the header of each file.

## IVR-CRM module (`/ivr`)

The Membership team's calling CRM, connected to Tata Smartflo (calls, recordings) and Zoho Mail. Built into the hub like Cab Booking:
code in `src/app/ivr`, `src/lib/ivr`, `src/components/ivr`, tables prefixed `ivr_` (`src/db/ivr-schema.ts`). It reaches the hub only through
`src/lib/ivr/host-adapter.ts`. It is off unless `IVR_ENABLED=true`; every page and route is a 404 until then.

- **Two applications** in Administrator → Applications: **IVR-CRM** (address `/ivr`), given to the Membership team, and **IVR-CRM Admin**
  (`/ivr/admin`), given to the one or two IVR admins.
- **Roles.** `ivr_agent`: given IVR-CRM. `ivr_admin`: an App Admin of IVR-CRM Admin who has also been given it (as for every Admin
  application). `ivr_super_admin`: the Support Admin (`head_admin`) only, the one who also manages Integrations (the Smartflo credentials).
- **An agent sees only their own.** Their queue, pipeline and member panel show only the members they own (`ivr_leads.owner_id`); My
  calls, their KPIs, a member's call history and recordings only the calls they handled (`ivr_calls.agent_user_id`). In `/ivr` everyone
  acts as an agent, admins included. The admin section sees every member and call, assigns and reassigns, imports, and has team analytics,
  PDF reports, categories and the retry rule, and links agents to their Smartflo agent.
- **Calls** come in three ways, all through one function keyed on the Smartflo call id (`src/lib/ivr/smartflo/ingest.ts`): Smartflo's
  webhook (`/api/ivr/webhooks/smartflo/<SMARTFLO_WEBHOOK_SECRET>`, open in `src/proxy.ts` because Smartflo cannot sign in: the secret is
  the gate), the Call button (Smartflo rings the agent first, then the member), and the sync: a heartbeat from every open IVR-CRM tab
  during working hours, plus the daily cron `/api/cron/ivr-sync?hours=48` (`CRON_SECRET`). The Smartflo account is shared with other
  departments, so only calls handled by an IVR-CRM agent or on a Membership line are kept.
- **Settings:** `IVR_ENABLED`, `IVR_ENCRYPTION_KEY` (encrypts the stored Smartflo login and the agents' Zoho tokens), `SMARTFLO_MODE`,
  `SMARTFLO_WEBHOOK_SECRET`, optional `SMARTFLO_CALLER_ID` and `SMARTFLO_API_BASE`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_DOMAIN`
  (see `docs/ivr-zoho-setup.md`).
- **Database:** `scripts/apply-0036-ivr.sql` (new tables only; run it before deploying).
- **Tests:** `node tests/e2e/ivr.mjs` against a site with `IVR_ENABLED=true SMARTFLO_MODE=mock` (and `E2E_IVR_OFF=yes` against one with
  it off).
- **Not yet checked against a real Smartflo account** (from the original IVR app): the Click to Call request fields, whether Smartflo echoes
  the dial request id on webhooks, and the hang-up-cause mapping. Expect to adjust `src/lib/ivr/smartflo/normalize.ts` after the first real
  call and sync.

## Database portability

- Plain Postgres only, no Neon-specific features. Portable column types; uuids come from `gen_random_uuid()` (Postgres 13+, no extension).
- All DB access goes through `src/db/index.ts`. `DB_DRIVER=neon` uses `drizzle-orm/neon-http`; `DB_DRIVER=pg` uses `drizzle-orm/node-postgres` with a `pg` Pool (max 5), always over TLS with the certificate checked, except for a database on localhost.
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
5. In Vercel set `DB_DRIVER=pg` and `DATABASE_URL` (TLS with certificate checking is always on).
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

Notifications, comments, chat, access requests (a person asking for an application they do not have), and single sign-on into the linked applications.
