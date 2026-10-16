# Verification record

What was run, on what, with what result. Everything below was run against a **scratch copy** of the code with its own local PostgreSQL 17
(never the live database). Date: 2026-10-15.

## Suites

| Suite | How to run | Result |
|---|---|---|
| Type check | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |
| Unused-code scan | `npx knip` | clean |
| Production build | `npm run build` | succeeds; all new routes present |
| Unit | `npm run test:unit` | **178 / 178** (permissions matrix, now with the Super Admin and Admins with areas, import parsing, real Excel files, zip-bomb refusal, address safety, audit scrubbing, "every server action is guarded", "every route handler checks who is asking", plus the Approvals rules, including who decides when the first approver raises a request and the same-person check) |
| Hub integration (database) | `npm run test:integration:hub` | **177 / 177** (the roles: what a Super Admin and an Admin with areas can see and change, bulk add limits; atomic access changes, team-manager limits, directory, bulk import and retry, one-time links, audit, revocation, deactivation, 200 × 4 grants) |
| Approvals integration (database) | `npm run test:integration` | **216 / 216** (the earlier 108, plus return for corrections and resubmitting, the first approver raising his own request, the first-approver/DG rule, and HR amounts with budgets) |
| Hub in a browser | `npm run test:e2e` | **225 / 225** (the earlier 186 checks, ported to the new screens, plus new ones) |
| Users & Access in a browser | `npm run test:e2e:people` | **112 / 112** |
| Approval System in a browser | `npm run test:e2e:approvals` | **85 / 85** (regression) |
| Approval System request flow | `npm run test:e2e:approvals:flow` | **165 / 165** (the earlier 104, plus returning, correcting and resubmitting in the browser, returning from the inbox, HR with an amount, and the rule check) |
| Roles in a browser | `npm run test:e2e:roles` | **98 / 98** (Support Admin sets an Admin's areas and roles; Super Admin; Admins with different areas see and open only theirs; plain users and Admins with nothing on are kept out) |
| **Total checks** | | **1,256** |

All browser suites write only rows with test names (`ZZ…`, `zz-…`, `ZZP…`, `zzp-…`), remove them afterwards, remove the audit entries they caused, and
confirm that existing departments, applications, branches, teams, people and access are exactly as before.

## What the tests found, and what was done

| Found by | Problem | Fixed |
|---|---|---|
| Unit test | A spreadsheet header written "E-mail Address" was not recognised | Yes: header aliases |
| Browser test | The Branches & teams page was wider than a phone screen (520 px on a 390 px screen) | Yes: grid children can now shrink |
| Production build | A type error in the load-test file stopped the build | Yes |
| Real link checks | Two Streamlit applications reported "too many redirects": the checker kept no cookies, a browser does | Yes: the checker keeps cookies while following redirects |
| Own review | The set-password action hashed before checking the link, so guessing links could burn server time | Yes: the link is looked up first |
| Own review | The directory read a person's password hash into memory | Yes: only needed columns are read |
| Mistakes of mine, caught and put right | A script truncated `administrator/layout.tsx` (restored from git); a `git rm --cached` staged three deletions (unstaged) | Yes |

Several test expectations were also wrong (the page shows labels in capitals, a person already held an application); those were corrected in the
tests, not by changing the product.

## Coverage of the acceptance criteria

| # | Criterion | Evidence | Verdict |
|---|---|---|---|
| 1 | Evaluated at 100, 150, 200 concurrent users | `docs/PERFORMANCE.md` | Met (one process, local database: see its limits) |
| 2 | Results, errors and bottlenecks documented | `docs/PERFORMANCE.md` | Met |
| 3 | A user's whole access configuration in one place | Profile page; `people.mjs` §2, §3, §6 | Met |
| 4 | Assign and revoke through a simple workflow | Assign dialog (choose, review, confirm, result); `suite.mjs` §8b, `hub-integration` §1, §2 | Met |
| 5 | Import many people from a validated CSV or XLSX | `people.mjs` §5, `suite.mjs` §5, unit tests | Met |
| 6 | Credentials without plaintext exposure | Setup links, hash-only storage; passwords refused in files; audit and reports hold none | Met |
| 7 | Branch, department, team and manager validated | `hub-integration` §4, §5; `people.mjs` §2 | Met |
| 8 | Import results show successes and failures | Results table, downloadable report, retry; `suite.mjs` §5 | Met |
| 9 | Existing users, applications and permissions not lost or changed | Migration is additive; row counts unchanged on a copy with data; every browser suite's "exactly as before" check | Met |
| 10 | Every listed application has a documented result | `docs/APP-INVENTORY.md`: all 12 live entries | Met for link checks; application features are the owners' to test |
| 11 | Unauthorised application and API access blocked | Guard tests on all 43 actions and 3 route handlers; `/go` refusals; team-manager and non-admin tests | Met for everything the hub controls; not possible for external applications (see assessment) |
| 12 | Works on desktop and mobile sizes | Phone-width overflow checks on the hub and every administrator page | Met |
| 13 | Automated tests pass; production build succeeds | table above | Met |
| 14 | Incomplete work, known issues and risks documented | `docs/ASSESSMENT.md` §6 | Met |

## Re-running everything

```
npm run typecheck; npm run lint; npx knip; npm run build; npm run test:unit
# with INTEGRATION_DB_CONFIRM=yes and INTEGRATION_DATABASE_URL pointing at a scratch database:
npm run test:integration:hub; npm run test:integration
# with the built site running and E2E_BASE_URL set (and HEAD_ADMIN_EMAIL / HEAD_ADMIN_PASSWORD in the environment):
npm run test:e2e; npm run test:e2e:people; npm run test:e2e:approvals; npm run test:e2e:approvals:flow
```
