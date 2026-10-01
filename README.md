# MCCIA App Hub

One front office for every MCCIA web app. Staff sign in with email and password, pick a department in the sidebar, and open the applications the administrator has given them, shown as square cards. The hub stores links, controls exactly which user sees which app, and logs logins and launches. It does not host the apps. Everything is managed from **Administrator** (head admin only), so adding a department, app, user or access change never needs a redeploy.

Stack: Next.js 16 (App Router, TypeScript), Tailwind CSS v4, Postgres + Drizzle ORM, Auth.js v5 (email + password with bcrypt; Google optional), lucide-react, zod.

All commands below are PowerShell.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local     # then fill it in
npx drizzle-kit migrate               # or: npm run db:migrate
npx tsx scripts/seed.ts               # or: npm run db:seed (safe to re-run)
npm run dev
```

Environment variables (see `.env.example`): `DATABASE_URL`, `DB_DRIVER` (`neon` or `pg`), `DATABASE_SSL`, `AUTH_SECRET`, `AUTH_URL`, `HEAD_ADMIN_EMAIL`, `HEAD_ADMIN_NAME`, and optionally `HEAD_ADMIN_TEMP_PASSWORD` (otherwise the seed generates one and prints it once), `ALLOWED_EMAIL_DOMAIN` (when set, new users must use it), `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (Google sign-in appears only when both are set).

The seed creates the six departments (Finance, CRM, Creative, Inventory, Safety Week, Approval System) and the head admin with a temporary password that must be changed at first login. Applications are added later in Administrator.

Useful scripts: `npm run db:generate`, `npm run db:migrate`, `npm run db:seed`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Deployment (Vercel + Neon)

1. Create the Neon project and copy the **pooled** connection string into `DATABASE_URL`.
2. In Google Cloud Console create OAuth credentials (Web application). Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` and `https://<your-domain>/api/auth/callback/google`.
3. Generate the secret: `npx auth secret` and put it in `AUTH_SECRET`.
4. Apply migrations: `npx drizzle-kit migrate`. Never use `push` on production.
5. Seed: `npx tsx scripts/seed.ts` (note the head admin temporary password it prints)
6. Push to GitHub, import the repo in Vercel, add all env vars, deploy.
7. Set `AUTH_URL` to the production URL and add the custom domain (for example `apps.<orgdomain>`).
8. Sign in as the head admin, open Administrator, and replace the sample data with real departments, apps and users.

## Test login (optional)

Set `TEST_LOGIN_USER` and `TEST_LOGIN_PASSWORD` in the env and typing that username and password into the normal login form signs in as `HEAD_ADMIN_EMAIL`. Leave both empty (or remove them) in production. `DEV_AUTH_BYPASS=true` (development only) skips login entirely.

## Access model

- **Login is required for everything.** There is no public page except `/login`.
- **Departments contain apps; every app belongs to exactly one department.** Access is granted per user per app (table `user_app_access`), never per department. A user can hold apps from several departments.
- **Roles:** `head_admin` sees every app and is the only role that can open Administrator. `member` ("User") sees only the apps assigned to them. `dept_lead` ("Department admin") exists in the schema for later; there is no UI to create it and it has no extra powers beyond a read-only Activity page for its home department.
- **The sidebar** lists only departments where the user has at least one app. App URLs are never sent to the browser in lists; every card opens `/go/[appId]`, which re-checks access on the server, logs the launch, and redirects. Without access it returns 404.
- **Accounts:** the head admin creates users with a temporary password (`must_change_password`), and the user must change it before doing anything else. Passwords are bcrypt-hashed (cost 12) and never logged.
- **Login protection:** every attempt is recorded in `login_attempts`. 5 failed attempts for an email within 15 minutes lock it until the window passes (or the admin resets the password); 25 failed attempts from one IP in 15 minutes block that IP. Sessions last 8 hours.
- **Soft delete only:** users, apps and departments are deactivated, never deleted, so the activity log stays intact. The last active head admin cannot be deactivated or demoted. Role and `is_active` are re-read from the database on every request, and every mutation runs through a server action that first checks head-admin status.
- **Access management** (Administrator → Access): a per-user checklist tree (ticking a department ticks all its apps), a per-app user list with bulk add/remove, bulk assignment to many users, and reusable templates that are copied onto users and can then be customised.
- **Activity:** `activity_log` records `login` and `launch` actions with user, app, IP and time. Administrator → Activity shows the log, launches per app and department, active users this week, users who never launched an app, last login per user, and CSV export.
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
6. Redeploy and verify (sign in, open an app, check the activity log).
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

Each linked app keeps its own login for now. The `apps.app_token` column is there so a signed-JWT handoff can be added later without a schema change. Google or Microsoft sign-in for the hub itself can be added as another Auth.js provider (Google is already wired and switches on when its credentials are set).

## Out of scope

Notifications, comments, chat, and a Department Admin interface.
