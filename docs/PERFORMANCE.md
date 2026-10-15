# Performance readiness: method and acceptance criteria

**Status of this file.** The criteria below were written *before* any load test was run. The results section at the bottom is filled in only
with numbers a test actually produced (see `tests/load/`). Nothing here claims the platform supports 200 concurrent users until a run says so.

## What is being tested, and what that can and cannot prove

| Item | Detail |
|---|---|
| Target | A production build (`next build` + `next start`) of this repository, one Node process |
| Database | A local PostgreSQL 17 with the `pg` driver and a connection pool of 5 (the repository's default for `DB_DRIVER=pg`) |
| Load generator | `tests/load/run.mjs`: plain Node, no extra packages, real HTTP, real cookies, real sign-in |
| Data | `tests/load/seed.mts`: 400 people, 6 departments, 40 applications, 4 branches, 12 teams, 6–15 grants each, 20,000 activity rows, all named `zz-load-*` / `ZL *` |
| Never | Against the live site or the live database. The seed refuses anything but a database whose name contains `load`, `scratch` or `test`, and refuses Neon addresses. |

**What a local run proves:** how many requests one server process can answer, how the code behaves under concurrency (errors, timeouts, slow
queries, lock waits), and where the first bottleneck is.

**What it cannot prove:** the capacity of the real deployment (Vercel functions scale out across many instances and talk to Neon over HTTP; this
test runs one process against a local database with no network distance). Treat results as a *per-instance* floor, not a production guarantee.
To certify production, run the same `run.mjs` against a staging deployment backed by a Neon branch (not the live database).

## Workloads

| Scenario | What each virtual user (VU) does |
|---|---|
| `browse` (the normal day) | Holds a valid session. Loops: open the hub, switch department, open an application through `/go/<id>` (302), think 1–3 s. |
| `login` (a sign-in storm) | Opens `/login`, submits the real form (server action, scrypt), follows to the hub. All VUs start inside a 20 s window. |
| `admin` (10% of VUs) | Opens the dashboard, the people directory with a search and a filter, a profile, the audit log, the application inventory. |
| `write` (library level) | `tests/load/write-load.mts`: concurrent access changes, a 200-person bulk assignment, a 500-row import. Calls the server code directly: the writes are Next.js server actions, which cannot be driven by plain HTTP without their build-specific identifiers. |

Levels: **100, 150 and 200** concurrent VUs (60 s each after a 10 s ramp), then stress at **300, 400 and 500** to find the limit.
Think time of 1–3 s models people; a separate "no think time" run measures raw throughput.

## Acceptance criteria (fixed in advance)

Page requests are `/`, `/?d=…`, the directory, a profile, the dashboard. All numbers are from the load generator's side, in milliseconds.

| # | Criterion | Pass when, at 200 VUs |
|---|---|---|
| A1 | Errors | HTTP 5xx, connection failures and timeouts together are **under 1%** of requests |
| A2 | Page latency | p95 **≤ 1,000 ms** and p99 **≤ 2,500 ms** for hub pages |
| A3 | Launch redirect | `/go/<id>` p95 **≤ 500 ms** |
| A4 | Admin pages | p95 **≤ 1,500 ms** for the directory (with search/filter), profile, dashboard |
| A5 | Sign-in storm | p95 **≤ 3,000 ms** and **zero** failed sign-ins when all VUs sign in within 20 s |
| A6 | Throughput | Sustained requests per second does not fall as VUs rise from 100 to 200 (no collapse) |
| A7 | Database | Open connections never exceed the pool size; the probe query's p95 stays **≤ 250 ms** |
| A8 | Process health | Resident memory growth over a 60 s level **≤ 25%**; no process restart |
| A9 | Writes (library level) | 200 concurrent single-person access changes: p95 **≤ 1,500 ms**, **zero** errors, correct final state |
| A10 | Bulk assignment | 200 people × 10 applications in **≤ 3 s**, one statement |
| A11 | Bulk import | 500 rows created end to end (email off) in **≤ 120 s**, none duplicated on a second run |

A criterion is reported **Met**, **Not met** or **Not measured**, with the number next to it.

## Results

Run on 2026-10-15, one `next start` process and a local PostgreSQL 17 on one developer machine (server pid 57371 pool 5; server pid 62610 pool 20). Load generator and server share the machine's 8 cores.

### Normal day: browse, switch department, open an application, plus 10% administrators (think time 1 to 3 s)

| Run | Users | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Server CPU avg / max | Memory | DB connections (max) | DB probe p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mix | 100 | 3028 | 50.5 | 7 | 21 | 31 | 58 | 0 (0%) | 26% / 56.6% | 155 → 196 MB | 6 | 0.8 |
| mix | 150 | 4508 | 75.1 | 6 | 19 | 27 | 44 | 0 (0%) | 33% / 64.6% | 196 → 346 MB | 6 | 0.8 |
| mix | 200 | 6007 | 100.1 | 5 | 17 | 24 | 44 | 0 (0%) | 35% / 58.3% | 346 → 352 MB | 6 | 0.7 |

### Stress: beyond 200

| Run | Users | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Server CPU avg / max | Memory | DB connections (max) | DB probe p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| stress | 300 | 6756 | 150.1 | 5 | 18 | 25 | 44 | 0 (0%) | 41% / 72.5% | 348 → 350 MB | 6 | 0.8 |
| stress | 400 | 9089 | 202 | 4 | 16 | 23 | 37 | 0 (0%) | 46% / 76% | 350 → 353 MB | 6 | 0.7 |
| stress | 500 | 11375 | 252.8 | 4 | 18 | 28 | 62 | 0 (0%) | 53% / 83.7% | 353 → 346 MB | 6 | 0.9 |

### Raw throughput: 200 users with no think time

| Run | Users | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Server CPU avg / max | Memory | DB connections (max) | DB probe p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| no think time | 200 | 23785 | 528.6 | 350 | 578 | 856 | 1305 | 0 (0%) | 137% / 162.3% | 344 → 631 MB | 6 | 2.2 |

### Sign-in storm: every user signs in through the real form within 20 seconds, then opens the hub and an application

| Run | Users | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Server CPU avg / max | Memory | DB connections (max) | DB probe p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| login storm | 100 | 300 | 14.9 | 4 | 56 | 57 | 57 | 0 (0%) | 28% / 40.3% | 352 → 369 MB | 6 | 0.9 |
| login storm | 150 | 450 | 22.3 | 4 | 45 | 46 | 48 | 0 (0%) | 38% / 44.4% | 369 → 370 MB | 3 | 4.3 |
| login storm | 200 | 600 | 29.8 | 3 | 40 | 40 | 65 | 0 (0%) | 45% / 54.4% | 370 → 348 MB | 3 | 4.3 |

### Per-request detail at 200 users (normal day)

| Request | Count | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors |
|---|---|---|---|---|---|---|---|
| admin:audit | 99 | 1.7 | 11 | 22 | 27 | 27 | 0 |
| admin:dashboard | 89 | 1.5 | 8 | 19 | 27 | 27 | 0 |
| admin:directory | 89 | 1.5 | 15 | 33 | 36 | 36 | 0 |
| admin:filter | 89 | 1.5 | 14 | 25 | 31 | 31 | 0 |
| admin:inventory | 109 | 1.8 | 12 | 25 | 32 | 36 | 0 |
| admin:profile | 90 | 1.5 | 14 | 31 | 44 | 44 | 0 |
| admin:search | 89 | 1.5 | 12 | 24 | 31 | 31 | 0 |
| department | 1793 | 29.9 | 6 | 16 | 23 | 33 | 0 |
| home | 1769 | 29.5 | 6 | 15 | 21 | 31 | 0 |
| launch | 1791 | 29.9 | 3 | 6 | 9 | 14 | 0 |

### Per-request detail, 200-user sign-in storm

| Request | Count | p50 ms | p95 ms | p99 ms | Max ms | Errors |
|---|---|---|---|---|---|---|
| home | 200 | 3 | 5 | 6 | 8 | 0 |
| launch | 200 | 2 | 2 | 4 | 4 | 0 |
| login:page | 200 | 3 | 3 | 6 | 36 | 0 |
| login:submit | 200 | 39 | 40 | 50 | 65 | 0 |

### A larger database pool (20 connections instead of 5)

| Run | Users | Requests | Req/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Server CPU avg / max | Memory | DB connections (max) | DB probe p95 ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pool 20, mix | 200 | 4552 | 101.2 | 5 | 18 | 28 | 63 | 0 (0%) | 34% / 67.6% | 202 → 165 MB | 21 | 0.8 |
| pool 20, mix | 400 | 9053 | 201.2 | 5 | 20 | 32 | 79 | 0 (0%) | 48% / 79.4% | 165 → 346 MB | 21 | 0.9 |
| pool 20, no think time | 200 | 27837 | 618.6 | 330 | 439 | 653 | 759 | 0 (0%) | 144% / 175.7% | 346 → 766 MB | 21 | 1.7 |

### Write paths and concurrent reads and writes (library level, 200 at once)

| Test | Pool | Calls | p50 ms | p95 ms | p99 ms | Max ms | Errors | Wall ms |
|---|---|---|---|---|---|---|---|---|
| 200 simultaneous single-person access changes | 5 | 200 | 80 | 83 | 83 | 83 | 0 | 85 |
| 200 simultaneous directory searches | 5 | 200 | 116 | 135 | 140 | 140 | 0 | 142 |
| 100 searches + 100 access changes at once | 5 | 200 | 96 | 108 | 108 | 108 | 0 | 110 |
| 200 simultaneous single-person access changes | 20 | 200 | 106 | 107 | 108 | 108 | 0 | 110 |
| 200 simultaneous directory searches | 20 | 200 | 123 | 151 | 153 | 154 | 0 | 156 |
| 100 searches + 100 access changes at once | 20 | 200 | 106 | 121 | 121 | 121 | 0 | 123 |

| Test | Pool | Result |
|---|---|---|
| Final state correct after the 200 simultaneous changes | 5 | True |
| One bulk assignment, 200 people × 10 applications | 5 | 33 ms, 200 people changed |
| Import of 500 rows: check / create / second run | 5 | 8 ms / 314 ms (498 created, 2 flagged) / 90 ms (0 created, 0 duplicates) |
| Final state correct after the 200 simultaneous changes | 20 | True |
| One bulk assignment, 200 people × 10 applications | 20 | 36 ms, 200 people changed |
| Import of 500 rows: check / create / second run | 20 | 8 ms / 315 ms (498 created, 2 flagged) / 94 ms (0 created, 0 duplicates) |

### Acceptance criteria, judged against the numbers above

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| A1 | Errors under 1% at 200 users | **Met** | 0 of 6007 requests (0%), 0 timeouts, 0 server errors |
| A2 | Hub pages p95 ≤ 1000 ms and p99 ≤ 2500 ms | **Met** | department: p95 16, p99 23; home: p95 15, p99 21 |
| A3 | Launch redirect p95 ≤ 500 ms | **Met** | p95 6 ms |
| A4 | Administrator pages p95 ≤ 1500 ms | **Met** | audit 22; dashboard 19; directory 33; filter 25; inventory 25; profile 31; search 24 |
| A5 | Sign-in storm: p95 ≤ 3000 ms, zero failed sign-ins (200 users) | **Met** | submit p95 40 ms, p99 50 ms, failed 0 of 200 |
| A6 | Throughput does not fall from 100 to 200 users | **Met** | 50.5 → 75.1 → 100.1 requests per second |
| A7 | DB connections never exceed the pool (5, plus the load generator's own 1); probe p95 ≤ 250 ms | **Met** | max 6 connections; probe p95 up to 0.8 ms |
| A8 | Memory growth over a level ≤ 25%, no restart | **Not met** | largest growth 76% |
| A9 | 200 simultaneous access changes: p95 ≤ 1500 ms, zero errors, correct final state | **Met** | p95 83 ms, 0 errors, state correct: True (pool 5); pool 20 p95 107 ms |
| A10 | Bulk assignment 200 × 10 in ≤ 3 s | **Met** | 33 ms |
| A11 | 500-row import ≤ 120 s, nothing duplicated on a second run | **Met** | created in 314 ms; second run created 0, duplicates 0 |


### Memory, in detail (why A8 is "Not met")

| Level | Start → end | Growth |
|---|---|---|
| 100 users | 155 → 196 MB | +27% |
| 150 users | 196 → 346 MB | +76% |
| 200 users | 346 → 352 MB | +2% |
| 300, 400, 500 users | 348 → 350, 350 → 353, 353 → 346 MB | +1%, +1%, −2% |
| 200 users, no think time | 344 → 631 MB (pool 20: 346 → 766 MB) | +83% |

The first two levels (a cold server filling its caches) and the no-think-time run (over 500 requests a second) grew by more than the 25% limit I set,
so the criterion is not met as written. Between those, six levels in a row stayed flat at about 350 MB, which looks like warm-up and garbage-collector
lag rather than a leak, but **a leak has not been ruled out**: no long soak test was run, and memory after the no-think run was not measured once the load stopped.

## What the numbers say

- **Normal use is far inside the limits.** At 100, 150 and 200 people doing a realistic mix (and 10% administrators), the server answered 50, 75 and 100 requests a second with a p95 of 17 to 21 ms, a p99 under 32 ms, and **no errors**. It kept scaling with the user count up to 500 users (253 requests a second, p95 18 ms, no errors).
- **Raw capacity.** With no think time, 200 users saturate one process at about 530 to 620 requests a second (p95 about 440 to 580 ms, CPU above one core, still no errors). A real crowd of 200 produces about 100 a second, so one process has roughly five times the headroom.
- **Sign-in.** Each sign-in costs about 31 ms of CPU for the password check (measured). 200 people signing in inside 20 seconds: p95 40 ms, none failed. If all 200 pressed the button in the same second they would queue behind Node's four crypto threads, giving a tail of roughly 1.6 s on one instance (arithmetic, not measured).
- **Database.** Connections never exceeded the pool. Every page's queries run in under half a millisecond on the seeded data (the plans use indexes or tiny scans; the audit log's newest-first page uses its time index). Pool size 5 versus 20 made no measurable difference at this scale.
- **Writes.** 200 simultaneous single-person access changes: p95 83 ms, none lost, final state correct. One 200-person × 10-application assignment: 33 ms (one statement; the old per-person loop would have been about 600 sequential requests). A 500-row import: 314 ms to create (498 created, 2 correctly flagged); running it again created nobody and duplicated nothing.
- **Reads and writes together** (100 searches plus 100 changes at once): p95 108 ms, no errors.

## Bottlenecks and limits found

| # | Finding | Effect | What to do |
|---|---|---|---|
| 1 | **Distance to the database.** Every page waits on database round trips: the hub home 2 in a row, opening an application 3, the directory about 3. The live database is in the USA and staff are in India. | Not visible here (local database, sub-millisecond). With a round trip of 200 to 250 ms a page is roughly round trips × 0.2 s plus render: home about 0.5 to 0.7 s, opening an application about 0.7 to 0.8 s, directory about 0.8 to 1.0 s. **These are estimates from arithmetic, not measurements**, and they would put criterion A3 (launch p95 ≤ 500 ms) at risk in production. | Move Neon and Vercel to Singapore (`aws-ap-southeast-1`, `sin1`). That is the main speed-up available. |
| 2 | One Node process saturates at about 530 to 620 requests a second. | Five times what 200 people need; Vercel adds instances on its own. | None needed at this size. |
| 3 | Sign-in is deliberately slow (scrypt, about 31 ms CPU). | A synchronised burst queues. | None needed; a morning sign-in spread over minutes is trivial. |
| 4 | The directory loads every active person (up to 5,000) for the "reporting manager" picker. | Fine for hundreds; the page payload grows with people. | Above about 2,000 people, turn the picker into a search box. |
| 5 | Name search is a sequential scan of `users`. | 0.27 ms at 400 people. | Above about 10,000 people add a trigram index. |
| 6 | Memory growth under heavy load (above). | Unknown without a soak test. | Run a one-hour soak (`npm run test:load -- --seconds 3600`) on staging. |
| 7 | Two directory queries run per page load on top of eight lookups (branches, departments, teams, applications, catalog, templates, managers). | Parallel, tiny. | None needed. |

## Caching and re-rendering

No cross-request caching is used on purpose: a revoked or deactivated person must lose access on their very next click, and that is only true because
each request reads the database. Within one request, `getCurrentUser`, `getAccessibleApps` and `getVisibleDepartments` are de-duplicated, so the layout and
the page share one lookup. In the browser the directory only re-renders the table on a change, and typing in the search box waits 350 ms before asking the server.

## What was not tested

- **Vercel and Neon.** One local process against a local database is not the live deployment: no scale-out, no network distance, no Neon cold start or autoscaling limits. To certify production, run `npm run test:load` against a **staging** deployment backed by a Neon **branch** (never the live database).
- **Email.** Delivery of 200 invitations through a real mail server (the hub sends them five at a time).
- **Long soak, and the Approval System under load.**
