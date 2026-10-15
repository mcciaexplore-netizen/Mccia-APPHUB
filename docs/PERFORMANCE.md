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
