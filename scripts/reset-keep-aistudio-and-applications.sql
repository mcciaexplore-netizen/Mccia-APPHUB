-- Clears ALL data from the live database, keeping only:
--   * the main Support Admin account, aistudio@mcciapune.com
--   * the applications and their application categories (what shows on the home page)
--   * the approval settings (the ₹10,000 limit and the email switches)
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once.
--
-- BEFORE YOU RUN IT: make a backup. In Neon, create a branch (or a snapshot) of the database first. THIS CANNOT BE UNDONE.
--
-- Deleted: every other account (including sujalc@mcciapune.com), all approval requests with their files and history, the expense types,
-- HR request types and publications, branches and teams, budgets, form field changes, everyone's application access and access templates,
-- notifications, sign-in records, link-check history, and the audit and activity logs.
-- It stops and changes nothing if aistudio@mcciapune.com does not exist or is not a Support Admin.
-- One transaction: if anything fails, nothing is deleted.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'aistudio@mcciapune.com' AND role = 'head_admin') THEN
    RAISE EXCEPTION 'aistudio@mcciapune.com is not a Support Admin in this database: nothing was changed.';
  END IF;
END $$;

-- Approval System: requests and everything about them
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

-- Approval System: its lists and records (the settings row is kept)
DELETE FROM apr_admin_audit;
DELETE FROM apr_form_fields;
DELETE FROM apr_user_roles;
DELETE FROM apr_category_budgets;
DELETE FROM apr_budgets;
DELETE FROM apr_approver_rules;
DELETE FROM apr_publications;
DELETE FROM apr_publication_types;
DELETE FROM apr_categories;
DELETE FROM apr_hr_categories;
DELETE FROM apr_branches;

-- Hub: access, logs and notifications (applications and their categories are kept)
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

-- Hub: branches and teams
UPDATE users SET branch_id = NULL, team_id = NULL, reporting_manager_id = NULL, home_department_id = NULL;
DELETE FROM teams;
DELETE FROM branches;

-- Every account except the main Support Admin
DELETE FROM users WHERE email <> 'aistudio@mcciapune.com';

COMMIT;

-- Afterwards these should show only aistudio@mcciapune.com, and your applications still there:
-- SELECT name, email, role FROM users;
-- SELECT count(*) FROM apps;
