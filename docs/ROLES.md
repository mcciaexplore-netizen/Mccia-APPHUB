# Roles in the App Hub

Five kinds of person, and what each can do. The rules live in one file, `src/lib/rbac.ts`; every screen and every server action asks it.

| Role | Who | Can do |
|---|---|---|
| **Support Admin** (`head_admin`) | AI Studio (an environment account, see below) | Everything. The **only** one who changes roles and what each Admin may open. |
| **Super Admin** (`super_admin`) | The DG | Everything in the software (people, access, applications, audit, activity, bulk add), except changing roles and the Admins' areas. |
| **Admin** (`admin`) | People the Support Admin chooses | Only the areas of Administrator the Support Admin has switched on for them (below). Nothing is on until it is ticked. |
| **User** (`member`) | Everyone else | Opens the applications assigned to them. New accounts are Users unless the Support Admin chooses otherwise. |
| Team manager (`dept_lead`) | nobody today | Kept as it was (their team's people only). Not needed under this model. |

## What an Admin can be given

| Area | Lets them |
|---|---|
| Users & access | Add and edit people, give or take away applications (any application), send setup links, reset passwords, deactivate users |
| Bulk add | Import people from a CSV or Excel file |
| Branches & teams | Create and change branches and teams |
| Applications | Departments, the application list, link checks |
| Audit log | See and export who changed what |
| Activity log | See and export which applications were opened |

## The four main accounts (set in the environment, not on screen)

| Account | Settings | What it is |
|---|---|---|
| **Support Admin** | `SUPPORT_ADMIN_*` (or the older `HEAD_ADMIN_*`) | Everything, including access, roles, applications and every Approval System setting. |
| **Super Admin** | `SUPER_ADMIN_*` | The DG: the **final approver on all approvals** (step 2 of HR and of expenditure of ₹10,000 and above) and sees every request. |
| **HR** | `HR_ADMIN_*` | The HR reviewer (step 1 of HR requests). Approvals and the applications given to them only; cannot open Administrator. |
| **Expenditure** | `EXPENDITURE_ADMIN_*` | The first approver of expenses (step 1, both sizes). Same limits as HR. |

Each is set with `<PREFIX>_EMAIL`, `<PREFIX>_NAME` and `<PREFIX>_PASSWORD`, in Vercel and in your local `.env`. They sign in with the password from the settings, so to change one you change it there and redeploy. From the screens none of them can be locked out, deactivated, deleted, have a password reset, or be given another role; the directory marks them "Main admin" (Support Admin, Super Admin) or "Main account" (HR, Expenditure), "password in settings". The Support Admin can still give HR and Expenditure applications, on their profile like anyone else.

Keep the old `HEAD_ADMIN_*` settings until the `SUPPORT_ADMIN_*` ones are live and you have signed in with them: removing both would lock the Support Admin out.

**Approver Rules:** the first time HR, Expenditure and the Super Admin are all set, the Approver Rules that have nobody named are filled from them, once (HR reviews HR; Expenditure is the first approver on expenses; the Super Admin is the final approver on HR and on expenditure of ₹10,000 and above). The Support Admin decides everything after that on the Approver Rules screen, and nothing is ever filled in again, so what they change or clear stays. The first approver and the Super Admin must still be different people.

Whatever is ticked, an Admin can **never**: change a role, change what an Admin may open, delete a person, or see or touch the Support Admin, the Super Admin or another Admin (not in the directory, not by address, not through an import). They are also not Approval System admins: that module keeps its own roles (the Approvals admin is still the Support Admin).

## Setting people up

1. Sign in as the Support Admin and open Administrator, then Users & Access.
2. **Add user** for each person. As the Support Admin you can choose Admin or Super admin (everyone else can only add Users). Each person gets a one-time setup link to choose their own password.
3. Open an Admin's profile and tick **What this Admin may open**, then save. It is recorded in the audit log.
4. Anyone can be promoted or demoted later from their profile (Role). Making an Admin a User clears their areas.

## Putting it live (order matters)

1. Run `scripts/apply-0010-in-neon-console.sql` in the Neon SQL editor (additive: two role values and one empty column).
2. Deploy the code. (Pages read the new column, so the code must not go first.)
