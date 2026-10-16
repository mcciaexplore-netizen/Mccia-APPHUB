# Roles in the App Hub

Five kinds of person, and what each can do. The rules live in one file, `src/lib/rbac.ts`; every screen and every server action asks it.

| Role | Who | Can do |
|---|---|---|
| **Support Admin** (`head_admin`) | AI Studio (the account set in the environment: `HEAD_ADMIN_EMAIL`) | Everything. The **only** one who changes roles and what each Admin may open. |
| **Super Admin** (`super_admin`) | The DG | Everything in the software (people, access, applications, audit, activity, bulk add), except changing roles and the Admins' areas. |
| **Admin** (`admin`) | Chintamani Shrotri, Satavisha Naidu, Rajnikant Gaikwad | Only the areas of Administrator the Support Admin has switched on for them (below). Nothing is on until it is ticked. |
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

## Main admins

The Support Admin and the Super Admin are both **main admins**: the directory marks them "Main admin", and neither can be deactivated or deleted through the screens. If the DG ever changes, change the Super Admin's role first, then deactivate them. The Support Admin's password lives in the environment settings (`HEAD_ADMIN_PASSWORD`); the Super Admin has a normal password (set through a setup link) and can change it.

Whatever is ticked, an Admin can **never**: change a role, change what an Admin may open, delete a person, or see or touch the Support Admin, the Super Admin or another Admin (not in the directory, not by address, not through an import). They are also not Approval System admins: that module keeps its own roles (the Approvals admin is still the Support Admin).

## Setting people up

1. Sign in as the Support Admin and open Administrator, then Users & Access.
2. **Add user** for each person. As the Support Admin you can choose Admin or Super admin (everyone else can only add Users). Each person gets a one-time setup link to choose their own password.
3. Open an Admin's profile and tick **What this Admin may open**, then save. It is recorded in the audit log.
4. Anyone can be promoted or demoted later from their profile (Role). Making an Admin a User clears their areas.

## Putting it live (order matters)

1. Run `scripts/apply-0010-in-neon-console.sql` in the Neon SQL editor (additive: two role values and one empty column).
2. Deploy the code. (Pages read the new column, so the code must not go first.)
