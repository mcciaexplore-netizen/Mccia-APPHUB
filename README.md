# MCCIA App Hub

One front office for every MCCIA web app. Pick a department in the sidebar and open its applications, shown as square cards. The hub stores links and logs launches. It does not host the apps. Everything is managed from **Administrator**, so adding a department, app or user never needs a redeploy.

**There is no login.** Everyone who opens the hub acts as the head admin, so anyone who can reach the URL can see and change everything. Keep the deployment private (for example with Vercel Deployment Protection) or add a login back before sharing it widely.

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

Environment variables (see `.env.example`): `DATABASE_URL`, `DB_DRIVER` (`neon` or `pg`), `DATABASE_SSL`, `HEAD_ADMIN_EMAIL` and `HEAD_ADMIN_NAME` (the head admin the hub acts as), and `ALLOWED_EMAIL_DOMAIN` (optional, comma-separated domains that users may have; empty means any domain).

The seed only creates the head admin named in the environment. Departments, apps and users are all added from Administrator.

Useful scripts: `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run typecheck`, `npm run lint`, `npm run build`.

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
3. Seed: `npx tsx scripts/seed.ts` with `HEAD_ADMIN_EMAIL` and `HEAD_ADMIN_NAME` set.
4. Push to GitHub, import the repo in Vercel, add `DATABASE_URL`, `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_NAME` (and the other variables you use), deploy.
5. Open the site, go to Administrator, and replace the sample data with real departments, apps and users.

## Access model

- **No login.** Every page is open, and everyone acts as the head admin (`HEAD_ADMIN_EMAIL`). Users, per-app access and templates are still stored and editable, but nothing enforces them until a login is added back.
- **Departments contain apps; every app belongs to exactly one department.** Access is granted per user per app (table `user_app_access`), never per department. A user can hold apps from several departments.
- **Roles:** `head_admin` sees every app and is the only role that can open Administrator. `member` ("User") sees only the apps assigned to them. `dept_lead` ("Department admin") exists in the schema for later; there is no UI to create it and it has no extra powers beyond a read-only Activity page for its home department.
- **The sidebar** lists only departments where the user has at least one app. App URLs are never sent to the browser in lists; every card opens `/go/[appId]`, which re-checks access on the server, logs the launch, and redirects. Without access it returns 404.
- **CSV import:** Administrator → Users → Import CSV takes columns `email`, `name` (required) and `apps`, `designation` (optional). `apps` lists app names separated by `;` (write `Department / App` when two apps share a name). Existing emails are skipped, never changed. A template can be downloaded from the panel.
- **Accounts:** the head admin creates users one at a time or by CSV. There are no passwords.
- **Soft delete only:** users, apps and departments are deactivated, never deleted, so the activity log stays intact. The last active head admin cannot be deactivated or demoted. Role and `is_active` are re-read from the database on every request, and every mutation runs through a server action that first checks head-admin status.
- **Access management** (Administrator → Access): a per-user checklist tree (ticking a department ticks all its apps), a per-app user list with bulk add/remove, bulk assignment to many users, and reusable templates that are copied onto users and can then be customised.
- **Activity:** `activity_log` records `launch` actions (earlier `login` entries are kept) with user, app, IP and time. Administrator → Activity shows the log, launches per app and department, active users this week, users who never launched an app, last login per user, and CSV export.
- **`app_token`** on each app is reserved for a future single sign-on handoff (a signed JWT passed to the child app). It is stored and shown to the head admin only; nothing uses it yet.

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

- Apps, users and departments are never hard-deleted; deactivate them instead.
- CSV export is head admin only. Cells that start with `= + - @` are prefixed with an apostrophe to prevent spreadsheet formula injection.
- Non-admins visiting `/administrator` are redirected to `/`. Because the page streams behind a loading skeleton, the redirect arrives as a streamed redirect (HTTP 200 with a redirect instruction) rather than a 307, and no Administrator data is included in the response.
- App icons are picked from the built-in icon set (no image upload), because the serverless host has no persistent file storage.
- The last-admin check reads then writes without a transaction (see the neon-http note), so two admins demoting each other in the same instant could race. Negligible for this use.

## Future work: SSO for the linked apps

Each linked app keeps its own login for now. The `apps.app_token` column is there so a signed-JWT handoff can be added later without a schema change.

## Out of scope

Notifications, comments, chat, and a Department Admin interface.
