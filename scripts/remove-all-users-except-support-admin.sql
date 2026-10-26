-- Removes every user account except the Support Admin (role head_admin), so the real people can be added in the app.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once.
--
-- BEFORE YOU RUN IT: make a backup. In Neon, create a branch (or a snapshot) of the database first. THIS CANNOT BE UNDONE.
--
-- Deleted with each account: their application access, setup links, sign-in records, notifications and approvals roles. The change history
-- (audit and activity logs) is kept, showing them as a deleted person. Applications, categories and approval requests are NOT touched,
-- unless you also run the optional part at the bottom.
--
-- ALSO DO in Vercel (Settings > Environment Variables), then redeploy: delete SUPER_ADMIN_*, HR_ADMIN_* and EXPENDITURE_ADMIN_*. Keep
-- SUPPORT_ADMIN_* (or HEAD_ADMIN_*): that is your own sign-in.
-- One transaction: if anything fails, nothing is deleted.

BEGIN;

-- Nobody points at someone who is about to go (the Support Admin's own manager link, for example).
UPDATE users SET reporting_manager_id = NULL WHERE reporting_manager_id IN (SELECT id FROM users WHERE role <> 'head_admin');

-- Approvals tables that name people without a database link.
DELETE FROM apr_user_roles WHERE user_id IN (SELECT id FROM users WHERE role <> 'head_admin');
DELETE FROM apr_notifications WHERE user_id IN (SELECT id FROM users WHERE role <> 'head_admin');
DELETE FROM login_attempts WHERE email IN (SELECT email FROM users WHERE role <> 'head_admin');

-- The accounts (their access, setup links and hub notifications go with them).
DELETE FROM users WHERE role <> 'head_admin';

COMMIT;

-- Afterwards this should list only the Support Admin:
-- SELECT name, email, role FROM users;

-- OPTIONAL: also delete every approval request (all of them are test requests raised by the people removed above).
-- Remove the "--" at the start of the next 10 lines to run it.
-- BEGIN;
-- DELETE FROM apr_approval_events;
-- DELETE FROM apr_request_steps;
-- DELETE FROM apr_attachments;
-- DELETE FROM apr_notifications;
-- DELETE FROM apr_expenditure_details;
-- DELETE FROM apr_hr_details;
-- DELETE FROM apr_requests;
-- DELETE FROM apr_file_chunks; DELETE FROM apr_files; DELETE FROM apr_counters;
-- COMMIT;
