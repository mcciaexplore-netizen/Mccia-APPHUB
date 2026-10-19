-- Deletes ALL data from the live database and keeps only the Support Admin account(s) (role head_admin).
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once.
--
-- BEFORE YOU RUN IT: make a backup. In Neon, create a branch (or a snapshot) of the database first, so it can be recovered.
-- THIS CANNOT BE UNDONE.
--
-- Deleted: every approval request with its files, steps, history and notifications; request numbers (they start again at 0001);
-- every user except the Support Admin, with their app access, sign-in history, setup links and notifications; every application,
-- application category, branch and team; the hub's audit and activity logs; expense types, HR request types, publications,
-- approval branches, the old budgets, form field changes, approvals roles and the approvals audit log.
-- Kept: the Support Admin account(s), the approval settings (the ₹10,000 limit and email switches) and the approver rules themselves,
-- emptied (nobody named), so Who Approves What still has its steps to fill in.
--
-- Note: the Super Admin, HR and Expenditure accounts are defined in Vercel (SUPER_ADMIN_*, HR_ADMIN_*, EXPENDITURE_ADMIN_*).
-- They come back the next time the Approval System is opened unless those settings are deleted in Vercel too.
-- One transaction: if any statement fails, nothing is deleted.

BEGIN;

-- Approval System: requests and everything hanging off them
DELETE FROM apr_approval_events;
DELETE FROM apr_request_steps;
DELETE FROM apr_attachments;
DELETE FROM apr_notifications;
DELETE FROM apr_expenditure_details;
DELETE FROM apr_hr_details;
DELETE FROM apr_requests;
DELETE FROM apr_file_chunks;
DELETE FROM apr_files;
DELETE FROM apr_counters;
DELETE FROM apr_rate_limits;

-- Approval System: lists, roles, form changes, audit
DELETE FROM apr_admin_audit;
DELETE FROM apr_form_fields;
DELETE FROM apr_user_roles;
DELETE FROM apr_budgets;
DELETE FROM apr_publications;
DELETE FROM apr_publication_types;
DELETE FROM apr_categories;
DELETE FROM apr_hr_categories;
DELETE FROM apr_branches;
UPDATE apr_approver_rules SET approver_user_ids = '{}';

-- Hub: applications, access and logs
DELETE FROM access_template_apps;
DELETE FROM access_templates;
DELETE FROM user_app_access;
DELETE FROM user_department_access;
DELETE FROM app_checks;
DELETE FROM activity_log;
DELETE FROM access_audit;
DELETE FROM login_attempts;
DELETE FROM user_invites;
DELETE FROM hub_notifications;
DELETE FROM apps;

-- Hub: categories, branches, teams (cleared from the Support Admin's profile first)
UPDATE users SET home_department_id = NULL, branch_id = NULL, team_id = NULL, reporting_manager_id = NULL;
DELETE FROM departments;
DELETE FROM teams;
DELETE FROM branches;

-- Every user except the Support Admin
DELETE FROM users WHERE role <> 'head_admin';

COMMIT;

-- Afterwards this should list only the Support Admin:
-- SELECT name, email, role FROM users;
