# Administration redesign: audit, what was built, what was left

Checked against the request "Redesign the Administration, User Access, Department Management, and Approval System". Most of it already
existed; this lists what was there, what was built now, and what was deliberately not changed.

## What already existed (kept, not rebuilt)

| Request | Where it is |
|---|---|
| Roles: Super Admin, Support Admin, HR, Expenditure | Four main accounts set in the environment (`docs/ROLES.md`); Admins with areas on top. |
| User list with search, filters, sort; user profile | Administrator > Users & Access (directory and profile). |
| Per-application access, enforced on the server | Profile > Application access; the launch route and every action check on the server, never only the buttons. |
| User's own Application tab, no duplicates | The hub home page; one row per person per application. |
| Approval workflow: Pending / Approved / Rejected, history, no self-approval, no double decisions, notifications to approver and requester | The Approval System (`docs/APPROVALS-RULES.md`). |
| HR and Expenditure approvals kept apart, filterable by status | The two applications under Approval System, each with Pending / Approved / Rejected lists. |
| Audit log, confirmation dialogs, empty/loading/error states | Audit log; shared dialogs and toasts. |

## Built now

- **Departments are now the organisation's.** A department row has a *kind*: `organisation` (Finance, IT, AI, ERU, Defense, CBP, Graphics, created for you) or `application` (the groups that arrange the applications in the hub: what used to be called departments: Finance, CAR Booking, Inventory...). Every department that existed before became an application category, so nothing moved. The sidebar and access checklists show application categories only; the people pickers and the directory filter show organisation departments only.
- **Administrator > Departments** (organisation): add, rename, deactivate; people per department linking to the directory filtered by that department. **Application categories** keeps the old screen under its real name. Both are in the Administrator menu.
- **Dashboard**: real counts of people, applications, people per department, approvals (pending HR, pending expenditure, approved, rejected: Support Admin only), recent changes (needs the Audit log area) and your own latest notifications.
- **Approvals page** (Administrator > Approvals, Support Admin only): HR and Expenditure side by side, counts by status that open the filtered lists, and what is waiting right now and for whom.
- **Notifications**: a bell in the header and a page listing everything addressed to the person, from the hub (access given or removed, role changed, what they may open changed) and from the Approval System, with Mark read and Mark all read. Stored in the database, one row per event (the same event twice is one row), and only ever the signed-in person's own.
- **Profile**: an *Approval responsibilities* box (HR reviewer, expenditure approver, final approver), worked out from the Approver Rules.
- **Access denied** on a direct link now says so in words (still a 404, so nobody learns which applications exist).

## Where the request conflicts with earlier decisions (kept as decided)

- The request says the Support Admin must not automatically get Super Admin power. You decided the Support Admin controls everything, so that stands.
- The request gives the HR and Expenditure Admins user and department management. You decided HR and Expenditure are approvals and applications only, so they stay that way.
- The request lists "Support / Expenditure / HR Administration" as separate admin modules. They are the four accounts, not extra menus.

## Not done (needs your decision)

- **A person in more than one department.** A person has one department. Several would need a separate table linking people to departments.
- **Applications filtered by department.** Applications belong to one application category; no link to the organisation's departments was added, because the business rule for it is not defined.
- **Department-based visibility.** Nothing yet shows or hides applications or approvals because of a person's department.
- **Filtering approval requests by department.** Requests do not carry a department (only the requester's name, and the branch for expenditure). Status, date, category, branch and a search by name or number all work on the real records.

## To put it live (order matters)

1. Run `scripts/apply-0011-in-neon-console.sql` in the Neon SQL editor first (additive: a kind on departments, a notifications table, seven departments).
2. Then deploy. The code reads the new column, so it must not go first.

## Later decision: the DG's scope

The Super Admin (the DG) has **no Administrator area**. They see only the applications the Support Admin assigns, the Approval Forms and the DG dashboard. Only the Support Admin manages people, roles and access. See `docs/ROLES.md` and `docs/APPROVALS-RULES.md`.
