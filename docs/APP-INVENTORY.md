# Application inventory and verification

Taken on **2026-10-15** from the hub's own database (the Neon project named `APPHUB`) with **read-only** queries on the `apps` and `departments`
tables. No person's data was read, no setting was changed, no application address or credential was touched. Link checks are one `HEAD`
request each (the same code behind **Administrator → Applications → Check**), sent from a developer machine.

## What each column means, and what it does not

| Column | Meaning |
|---|---|
| Link check | The address answered over a valid secure connection (certificate checked, redirects followed with cookies, private and internal addresses refused). **This proves the link works. It does not prove the application's own features work.** |
| People assigned | How many people hold this application through an explicit assignment. Head admins can open every application without one. |
| Sign-in | The hub requires its own sign-in to launch. Whether the application then asks for a second sign-in is the application's own business; the hub cannot see or enforce it. |

## The 12 entries in the live hub

| # | Department | Application | Address (host) | Shown in hub | Description | People assigned | Link check |
|---|---|---|---|---|---|---|---|
| 1 | Finance | Payment Advice | payment-advice.vercel.app | Yes | none | 0 | **Passed** (HTTP 200, about 0.2 s) |
| 2 | Finance | Payment Reminder | payment-reminder-git.streamlit.app | Yes | none | 0 | **Passed** (HTTP 200, about 2.3 s; a Streamlit sign-in handshake, needs cookies) |
| 3 | Finance | GST Reconcillation | huggingface.co/spaces/mccia/gst-reconciliation | Yes | none | 0 | **Passed** (HTTP 200) |
| 4 | CRM | Mini CRM | gen-crm-web.vercel.app/login | Yes | none | 0 | **Passed** (HTTP 200) |
| 5 | CRM | Stock List | stock-reorder-agent-git.streamlit.app | **Hidden** (inactive) | "For your business stocks" | 0 | **Passed** (same address as #10) |
| 6 | CRM | HR Studio | hr-studio-lake.vercel.app | Yes | none | 0 | **Passed** (HTTP 200) |
| 7 | Creative | Digital Profile Creator | cardsmith-digital-business-card-cre.vercel.app | Yes | none | 0 | **Passed** (HTTP 200) |
| 8 | Creative | Social Media Creatives | social-pro-livid.vercel.app | Yes | none | 0 | **Passed** (HTTP 200) |
| 9 | Creative | Card Scanner | v2-card-scanner.vercel.app | Yes | none | 0 | **Passed** (HTTP 200) |
| 10 | Inventory | Stock List | stock-reorder-agent-git.streamlit.app | Yes | none | 0 | **Passed** (HTTP 200, about 2.3 s) |
| 11 | Inventory | Dispatch Flow | dispatch-flow-v2.vercel.app | Yes | none | 0 | **Passed** (HTTP 200) |
| 12 | Approval System | Approvals | `/approvals` (a page of the hub itself) | Hidden by the hub (the Approval System is a built-in sidebar item now) | "HR and expenditure approvals with a full audit trail." | 0 | Not applicable (built in); covered by its own browser suites |

**Result: 10 of 10 external addresses are reachable.** (An earlier version of the checker reported the two Streamlit applications as failing with "too many redirects": that was a limit of the checker, which kept no cookies. A browser does, and the checker now does too.)

## What this inventory shows that needs a decision

1. **Nobody has any application assigned.** Every application has 0 people assigned, so today only head admins see any card. Before 100 to 200 people can use the hub, each needs assignments (Users & Access → Assign applications, or bulk add with applications). Nothing is assigned automatically, by design.
2. **"Stock List" is listed twice** with the same address (CRM, hidden; Inventory, shown). One of them is redundant.
3. **9 of 12 entries have no description**, so their cards say nothing about what the application does. The card now shows the department, the name, an availability label and an "Open application" action; a one-line description makes it much clearer.
4. **One name has a typo:** "GST Reconcillation" (should be "Reconciliation").
5. **The old "Approvals" card** (department "Approval System") is hidden by the hub and can be deleted from Administrator.
6. **Every label is currently "Active".** The new labels (Active, Under testing, Unavailable) are available on each application's edit form and in Administrator → Applications.

## What was not verified, and how to finish it

- **Features inside each application** (their buttons, forms, data, their own access rules, whether they are usable on a phone) were not tested: they are separate products with their own repositories and sign-ins. Each owner should run their own checks; the hub only guarantees who can launch them.
- **Access for specific people** could not be verified because nobody holds an assignment yet. The rules that enforce it (grant required, revoked access stops working, deactivated people are signed out, an unavailable application cannot be opened) are covered by `tests/hub-integration.mts` and `tests/e2e/people.mjs`; see `docs/VERIFICATION.md`.
- **Re-run any time:** Administrator → Applications → **Check all**, then **Export CSV** for a dated copy. A check is only called "Link verified" for 30 days.
