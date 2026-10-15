# Users, access and capacity: technical assessment and what changed

Written from reading the code before any change was made, then updated with what was done. File references are to this repository.
Test numbers are in `docs/VERIFICATION.md`; load-test numbers in `docs/PERFORMANCE.md`.

## 1. How the system worked before

| Area | What the code did |
|---|---|
| Stack and hosting | Next.js 16 (App Router) on Vercel, Neon Postgres over the stateless `neon-http` driver (no transactions), or a local `pg` pool of 5 with `DB_DRIVER=pg` (`src/db/index.ts`) |
| Sign-in | Email and password, scrypt hashes (`src/lib/passwords.ts`); an HMAC-signed 8-hour cookie that names the person, with the account re-read from the database on every request, so deactivation and password changes take effect at once (`src/lib/permissions.ts`). The main admin's password comes from the environment. |
| Administrator lock | A second cookie after a password re-check, dropped when the administrator leaves the area (`src/proxy.ts`) |
| Roles | `head_admin`, `member`, and `dept_lead` (no screen created it; it only scoped a read-only Activity page) |
| Organisation | **Departments only.** In the hub a department groups applications and doubles as a person's "home department". There was **no branch, team or reporting manager.** |
| Access | One table, `user_app_access` (person to application), enforced for hub visibility (`getAccessibleApps`) and launch (`/go/[id]` → `getLaunchTarget`). `user_department_access` and `login_attempts` existed but nothing used them. |
| Administration | Users page (everyone loaded and filtered in the browser), a separate Access page with a per-person editor, a per-application editor, bulk assign and templates, a CSV import with a **password column**, and an activity log of logins and launches only |
| Application launch | The hub stores each application's address; cards open `/go/[id]`, which re-checks access, logs the launch and redirects. Applications are external websites. |
| Audit | None for administrator actions. `activity_log` recorded login and launch only. |
| Tests | 186 browser checks, unit tests (CSV, domains, Approvals rules), Approvals integration tests; **no load test** |

## 2. Findings, with evidence, and what was done

| # | Severity | Finding | Evidence | What was done | Status |
|---|---|---|---|---|---|
| 1 | High | Passwords were typed by the administrator and written in plaintext in the import CSV | `ImportUsers.tsx` template with a `password` column; `importUsers` in the old `actions/users.ts` | Invitation flow: one-time link, hash-only storage, 72 h expiry, single use, cancelled by a newer link or by deactivation. Import refuses any password column (CSV or Excel). Setting a password by hand remains for people without email, is hashed at once and never recorded. | Fixed |
| 2 | High | No audit trail for people, access, branches, teams, templates or application changes | `adminAction` in `lib/action.ts` did not record anything | `access_audit` table; every action writes who, what, to whom, when, with applications added/removed and before/after in names; secrets are scrubbed before storing; viewer, filters, CSV export | Fixed |
| 3 | High | Access changes were not atomic and did not scale: revoke then grant as separate requests; bulk assign looped per person (about 3 round trips each); a failure left people half-changed with no per-person result | `setExactly`, `bulkAssign` in the old `actions/access.ts` | `src/lib/access-ops.ts`: each change is **one SQL statement** (data-modifying CTEs), validated first, with a review step and a per-person result. 800 grants in 25 ms locally versus roughly 600 sequential round trips before. | Fixed |
| 4 | Design limit | The hub gates cards and the launch route, but applications are external addresses; it cannot stop someone who knows an address from opening it. `app_token` for single sign-on was unused. | `lib/access.ts`; `schema.ts` | Documented plainly; "unavailable" and "revoked" are enforced at the hub. True enforcement needs each application to validate a hub-issued token (single sign-on). Not built. | **Open by design** |
| 5 | Medium | Unlimited password guesses (a product decision recorded in `REPORT.md`); each guess costs about 31 ms of CPU (measured) | `lib/auth.ts`; `login_attempts` unused | Not changed (deliberate). Mitigation advised: platform-level rate limiting. The new set-password page looks the link up **before** hashing, so guessing links cannot burn CPU. | Open (accepted) |
| 6 | Medium | There was no way to describe where a person sits (branch, team, manager) or to limit a manager to their own people | schema; `roleEnum` | `branches`, `teams`, `users.branch_id/team_id/reporting_manager_id` with validation (team-to-branch consistency, manager must be active, no loops via one recursive query); team manager scope in `src/lib/rbac.ts` used by every directory query and every action | Fixed |
| 7 | Medium | The people screen loaded every person and every grant and filtered in the browser; `select *` pulled password hashes into server memory | `users/page.tsx` (old) | Server-side search, filters, sorting and paging; only needed columns; a second query for the page's applications (no N+1) | Fixed |
| 8 | Low | Dead tables and an unused role | `user_department_access`, `login_attempts`, `dept_lead` | `dept_lead` is now the **Team manager** role. The two dead tables are left (harmless; removing needs a decision). | Partly |
| 9 | Low | The permission check on launch took two sequential queries | `getLaunchTarget` | One joined query (a person without the grant gets exactly the answer an unknown application gets) | Fixed |
| 10 | Info | The import took one row's checks and wrote them one at a time, with no preview | old `importUsers` | Check first (read-only, row-by-row with reasons and suggestions), then create in batches of 25, each person one atomic statement, safe to repeat | Fixed |
| 11 | Info | Latency is dominated by distance: functions and database are in the USA, staff are in India | `REPORT.md` §10 | Not changed. Move Neon and Vercel to Singapore (`aws-ap-southeast-1`, `sin1`) | Open (recommended) |

## 3. Design decisions

- **Branch and team are separate from departments.** Departments group applications; branches are office locations; teams are groups under a manager. The Approval System's own branches (cost centres) stay separate, as agreed earlier.
- **Roles:** super administrator (`head_admin`), team manager (`dept_lead`), user (`member`). A middle "Administrator" role was not added: the brief asked not to assume one, and nothing in the current business needs it. `src/lib/rbac.ts` is the single place to add it.
- **Atomic changes without transactions.** `neon-http` has no interactive transactions, and the code deliberately never uses them. Data-modifying CTEs give all-or-nothing behaviour in a single statement and run on both drivers.
- **No queue.** A 2,000-row import is driven in batches of 25 from the browser, each batch well inside the function time limit. A queue would add a service without a need.
- **Excel reading in the browser** (`fflate` plus a short parser) so a hostile file can only affect the administrator's own tab; the server re-validates every row it receives.
- **Application status** is what the administrator says (Active, Under testing, Unavailable). **Link verified** is only ever shown when a real check passed in the last 30 days.

## 4. Changes

**New tables (migration `0008_hub_org_audit_invites.sql`, additive):** `branches`, `teams`, `user_invites`, `access_audit`, `app_checks`; new nullable columns `users.branch_id`, `users.team_id`, `users.reporting_manager_id`; `apps.status` (default `active`, so existing applications behave exactly as before); indexes on the new foreign keys. Applied to a copy holding existing data: every existing row count unchanged, all applications `active`, no existing person touched.

**New:** `src/lib/{rbac,access-ops,accounts,audit,scrub,org,people,people-page,import,import-parse,xlsx-read,invites,mail,account-status,app-checks,net-guard,user-error}.ts`; `src/actions/{people,org,invite}.ts`; `src/components/people/*`; `/administrator` dashboard, `/administrator/users` (+ `/[id]`, `/import`, `/org`, `/audit`), `/administrator/inventory`, `/team`, `/set-password`.

**Changed:** `src/actions/{access,apps}.ts`, `src/lib/{action,permissions,access,format,validation}.ts`, `src/db/{schema,index}.ts`, `src/proxy.ts` (allows `/set-password`), `Sidebar`, `AdminNav`, `AppCard`, `AccessTree`, the application form, `next.config.ts` (server-action body limit 3 MB for large imports).

**Removed:** the old Users screen and CSV importer, `actions/users.ts`, the per-person access editor (its address now opens the new profile).

## 5. Deploying this

1. `npm run db:migrate` (applies `0008`; additive; take a backup first as always).
2. Set `APP_BASE_URL` (the site's address, used in setup links). Set `SMTP_HOST` and `SMTP_FROM` (and user/password) to email the links; without them the administrator is shown each link once.
3. Optionally `DB_POOL_MAX` if running `DB_DRIVER=pg`.
4. Existing people keep their passwords and access. New people are created with a setup link instead of a typed password.

## 6. Known limits and what is not done

- Direct access to an **external** application by someone who knows its address cannot be stopped from the hub (finding 4).
- **Access requests** ("ask for this application") are not built: there is no model for them yet.
- **Production inventory and link checks** were not run from here against the live database (see `docs/APP-INVENTORY.md`).
- **Load results are from one local process** against a local database, not Vercel and Neon (see `docs/PERFORMANCE.md` for what that does and does not prove).
- Unlimited password guesses remain (a recorded product decision).
- The two unused tables remain in the database.
