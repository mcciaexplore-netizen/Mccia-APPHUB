# MCCIA Approvals

Internal approval system for MCCIA: Expenditure (below ₹10,000), DG Approval for Expenditure (₹10,000 and above), DG Approval for HR,
Reimbursement and Events. React + Tailwind client, Express server, SQLite database.

## Run it

```bash
npm run install:all     # once: installs the root, server and client
npm run dev             # server on :3001, client on http://localhost:5173 (use this one)
```

For a single process (the server also serves the built client):

```bash
npm run build
npm start               # http://localhost:3001
```

`npm test` runs the API test (65 checks) and `npm run test:ui` the browser test (45 checks; run `npm run build` first and have Google Chrome installed). Both use a throwaway database and never touch `database/` or `uploads/`.

## Sign in

| Username | Role | Does |
|---|---|---|
| `employee` | staff | submits the five forms, answers "more information" requests |
| `shrotri` | approver | approves Expenditure, DG Expenditure, Reimbursement and Events; manages budgets and masters |
| `satavisha` | approver | approves HR requests |
| `dg` | dg | final approver for everything escalated; sees the full history; manages budgets and masters |

Password for all four: `mccia123`. Change it before real use (see below). The email addresses (`*@mccia.local`) are placeholders.

## Who approves what

| Form | Route |
|---|---|
| Expenditure (below ₹10,000) | Shrotri |
| DG Expenditure (₹10,000 and above) | Shrotri, then the DG |
| HR | Satavisha, then the DG |
| Reimbursement | Shrotri |
| Events | Shrotri; then the DG only when the budget is above ₹10,000 |

At every step the approver can **Approve**, **Reject** (reason required) or **Request More Info** (note required). More-info sends the
request back to the person who raised it, who edits and resubmits it; it returns to the same approver. Exactly ₹10,000 counts as
"₹10,000 and above". A request typed into the wrong Expenditure form is refused with a link to the right one.

## Budgets

Budgets are set per branch and category (Budgets page). On the expenditure, DG expenditure and reimbursement forms,
**Available Budget** = allocated minus the spend of *approved* requests, and **Budget Remaining** = available minus the amount being
typed. Going over shows a warning but does not block the request. Pending and rejected requests use no budget.

## Where things are

```
client/                 React app (Vite + Tailwind)
  src/
    components/
      common/           StatusBadge, PageTitle, Toaster
      layout/           Layout (page frame, phone top bar), Sidebar
      forms/            RequestForm (all five forms), FieldControl (one input per field type), FormRow
      approvals/        DecisionPanel, MoreInfoNotice, StageProgress, SubmissionFields, AuditTrail
    pages/
      auth/             Login
      dashboard/        Home, RequestList (every list), SubmissionDetail, ResubmitRequest
      admin/            Budgets, Masters
      expenditure/ dg-approval/ hr/ reimbursement/ events/    one thin page each: it opens that module's form
    context/            AppContext: who is signed in, the form definitions, toasts
    hooks/              useCounts, useSubmission, useBudget, useDebouncedCallback
    services/           every call to the server (http, auth, config, submission, budget, masters)
    constants/          nav (the menu per person), routes, status colours
    utils/              format (dates, ₹), validators
    styles/             index.css (Tailwind and the form look)
server/                 Express API
  modules.js            the five forms: their fields, order and who approves (the client draws the forms from this)
  app.js                the API: login, config, masters, budgets, submissions, approval actions, files
  db.js                 the SQLite schema, the starting data and password hashing
  index.js              starts the server (reads .env)
  test.js               API test (npm test)
tests/ui.mjs            real-browser test (npm run build, then npm run test:ui)
database/               mccia.db (created on first start)
uploads/                attached files (PDF, JPG, PNG, DOC, DOCX, XLS, XLSX, up to 10 MB each)
.env.example            the settings you can change
```

The forms are defined once, in `server/modules.js`; the client draws them from `GET /api/config`. To change a field, change it there.

## Settings

Copy `.env.example` to `.env`. Every setting is optional: `PORT`, `DB_FILE`, `UPLOAD_DIR`, `SESSION_SECRET`.

## Deploying

This app keeps its data in a SQLite file and its uploads in a folder, so it needs a server with a **persistent disk** (a small VM, or
a host with a mounted volume): set `DB_FILE` and `UPLOAD_DIR` to paths on that disk. It cannot run as it is on Vercel, whose
serverless functions have no persistent disk. On Vercel the approvals are the module inside the MCCIA App Hub (`/approvals`), which
uses the hub's Postgres database.

## Before real use

- Change the starting passwords. There is no change-password screen yet; for now replace the `password_hash` values in the `users`
  table (hashes are `scrypt$salt$hash`, made by `hashPassword` in `server/db.js`).
- Put the real email addresses in the `users` and `employees` tables, and add the real branches, publication types and publications
  on the Masters page (they start empty apart from "Head Office").
- Serve it over HTTPS (the session cookie is HttpOnly and SameSite=Lax; add `Secure` when it is behind HTTPS).
- Money is stored as whole paise; dates are shown as dd-MMM-yyyy.
