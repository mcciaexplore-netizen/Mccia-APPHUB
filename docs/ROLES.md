# Roles in the App Hub

Five kinds of person, and what each can do. The rules live in one file, `src/lib/rbac.ts`; every screen and every server action asks it.

| Role | Who | Can do |
|---|---|---|
| **Support Admin** (`head_admin`) | AI Studio (an environment account, see below) | Everything. The **only** one who changes roles and what each Admin may open. |
| **Super Admin** (`super_admin`) | The DG | An ordinary user of the hub plus the final approvals. Opens only the applications the Support Admin gives them, the Approval Forms and the DG dashboard. **No Administrator area at all.** |
| **Admin** (`admin`) | People the Support Admin chooses | Only the areas of Administrator the Support Admin has switched on for them (below). Nothing is on until it is ticked. |
| **User** (`member`) | Everyone else | Opens the applications assigned to them. New accounts are Users unless the Support Admin chooses otherwise. |
| Team manager (`dept_lead`) | nobody today | Kept as it was (their team's people only). Not needed under this model. |

## The Administrator menu

Five items, in the sidebar's Administrator menu: **Dashboard**, **Users** (the list of people; open one to see their details and tick the applications they may open), **Approval Forms** (the Support Admin only: where the forms everyone uses are edited, see below), **Notification Panel** and **Activity Log**. An Admin sees only the ones their areas allow, and never Approval Forms. There are no departments: the organisation departments were removed (migration 0014). Branches and teams, the audit log, bulk add, the application list and the application categories still exist at their addresses (for example `/administrator/users/org`, `/administrator/inventory`, `/administrator/departments`), they are just not in the menu.

## Approval Forms (editing the forms)

Under Administrator > Approval Forms the Support Admin edits the three forms everyone uses to raise a request: the HR form, the Expenses form (below ₹10,000) and the Expenditure form (₹10,000 and above). For each form:

- **Built-in fields** can be renamed and moved up or down. The optional ones can be hidden; the ones a request cannot do without (the person, the category, the branch, the amount, and for Expenses the email and vendor) are always shown.
- **Extra fields** can be added: short text, long text, number, date or a dropdown (with its choices). An extra field can be required, shown or hidden, moved, renamed and removed.
- A saved change applies to the next person who opens the form. Requests already sent keep the answers they were given, under the name the field had at the time, and show them on the request page. Answers to extra fields are not in the lists or the CSV export.

## What an Admin can be given

| Area | Lets them |
|---|---|
| Users & access | Add and edit people, give or take away applications (any application), send setup links, reset passwords, deactivate users |
| Bulk add | Import people from a CSV or Excel file |
| Branches & teams | Create and change branches and teams |
| Applications | Application categories, the application list, link checks |
| Audit log | See and export who changed what |
| Activity log | See and export which applications were opened |

## The four main accounts (set in the environment, not on screen)

| Account | Settings | What it is |
|---|---|---|
| **Support Admin** | `SUPPORT_ADMIN_*` (or the older `HEAD_ADMIN_*`) | Everything, including access, roles, applications and every Approval System setting. |
| **Super Admin** | `SUPER_ADMIN_*` | The DG: the **final approver on all approvals** (step 2 of HR and of expenditure of ₹10,000 and above). Sees only what is recommended to them (the Recommended Queue), the forms they rejected and the ones they completed. No all-requests lists, reports, budgets or export, and no Administrator. |
| **HR** | `HR_ADMIN_*` | The HR reviewer (step 1 of HR requests). Approvals and the applications given to them only; cannot open Administrator. |
| **Expenditure** | `EXPENDITURE_ADMIN_*` | The first approver of expenses (step 1, both sizes). Same limits as HR. |

Each is set with `<PREFIX>_EMAIL`, `<PREFIX>_NAME` and `<PREFIX>_PASSWORD`, in Vercel and in your local `.env`. They sign in with the password from the settings, so to change one you change it there and redeploy. The directory marks them "Main admin" (Support Admin, Super Admin) or "Main account" (HR, Expenditure), "password in settings". From the screens their password cannot be reset (it comes from the settings). The Support Admin and the Super Admin keep the role their settings give them (it is put back at every sign-in); HR and Expenditure start as ordinary users, and the Support Admin can give them another role, which then stays. Their details (name, designation, branch, team, reporting manager) can be edited, and the Support Admin can deactivate or delete them like anyone else; but because the settings still define the account, it is switched on again, or made again, the next time it signs in (or is needed) unless its settings are also removed in Vercel. The Support Admin can still give HR and Expenditure applications, on their profile like anyone else.

The Support Admin can be set with `SUPPORT_ADMIN_*` and the older `HEAD_ADMIN_*` at the same time: both work, so you can change over safely. Keep the old ones until you have signed in with the new ones, then you can delete them. An account counts only when its email **and** its password are both filled in; a half-filled setting is ignored and never locks anyone out.

**Approver Rules:** the first time HR, Expenditure and the Super Admin are all set, the Approver Rules that have nobody named are filled from them, once (HR reviews HR; Expenditure is the first approver on expenses; the Super Admin is the final approver on HR and on expenditure of ₹10,000 and above). The Support Admin decides everything after that on the Approver Rules screen, and nothing is ever filled in again, so what they change or clear stays. The first approver and the Super Admin must still be different people.

Only the Support Admin manages people, roles and access; the Super Admin cannot. Whatever is ticked, an Admin can **never**: change a role, change what an Admin may open, delete a person, or see or touch the Support Admin, the Super Admin or another Admin (not in the directory, not by address, not through an import). They are also not Approval System admins: that module keeps its own roles (the Approvals admin is still the Support Admin).

## The Approval Forms

The forms are for everyone who signs in; there is nothing to tick. The sidebar's **Approval System** is one link; it opens a page with two cards, **HR Approval Form** and **Expenditure Approval Form**. HR Approval Form opens the HR form; Expenditure Approval Form opens the Expenses form (below ₹10,000), which points to the DG Expenditure form for ₹10,000 and above. The Super Admin (the DG) has them too. An approver with something waiting is told so on that page.

The Approval System is not an application in the **Application access** box: the old "Approvals" card and the entry pages of HR Approval and Expenditure (which an earlier version offered as ticks, migration 0012) are left out of the box, and migration 0013 removes them from the database.

## What the Support Admin can do to people

The Support Admin can edit and delete **everyone**: an ordinary user, an Admin, the Super Admin and the main accounts. Only three things are refused: deleting or deactivating themselves, deleting or deactivating the last active Support Admin, and changing another Support Admin's role. Deleting is permanent (their account, password and application access; their past activity stays in the history as an unknown user); deactivating is reversible and signs the person out at once.

## Setting people up

1. Sign in as the Support Admin and open Administrator, then Users.
2. **Add user** for each person. Only the Support Admin can add people (Admins with areas can add Users) and choose Admin or Super admin. Each person gets a one-time setup link to choose their own password.
3. Open an Admin's profile and tick **What this Admin may open**, then save. It is recorded in the audit log.
4. Anyone can be promoted or demoted later from their profile (Role). Making an Admin a User clears their areas.

## Putting it live (order matters)

1. Run `scripts/apply-0010-in-neon-console.sql` in the Neon SQL editor (additive: two role values and one empty column).
2. Deploy the code. (Pages read the new column, so the code must not go first.)

To remove the two Approval System rows that migration 0012 added: run `scripts/apply-0013-in-neon-console.sql` (before or after the deploy; the code already leaves them out of the access box).
