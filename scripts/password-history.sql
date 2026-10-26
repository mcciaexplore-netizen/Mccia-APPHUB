-- Who was given a temporary password, by whom, when, how it was delivered, and what happened to it. Read-only: it changes nothing.
-- Paste into the Neon SQL Editor (project APPHUB) and run whenever you need it. Passwords are never stored in readable form, so none is shown.
--
-- One row per temporary password: a new account's first one, or a reset. Newest first.
SELECT
  u.name                                   AS person,
  u.email                                  AS sign_in,
  i.created_at AT TIME ZONE 'Asia/Kolkata' AS issued_at_ist,
  COALESCE(c.name, 'System')               AS issued_by,
  i.delivery                               AS email,          -- sent | failed | manual (passed on by hand) | pending
  i.expires_at AT TIME ZONE 'Asia/Kolkata' AS works_until_ist,
  i.used_at AT TIME ZONE 'Asia/Kolkata'    AS own_password_set_at_ist,
  CASE
    WHEN i.used_at IS NOT NULL THEN 'Used: they set their own password'
    WHEN i.expires_at <= now() THEN 'Expired or replaced'
    ELSE 'Waiting for them to sign in'
  END                                      AS status
FROM user_invites i
JOIN users u ON u.id = i.user_id
LEFT JOIN users c ON c.id = i.created_by_id
ORDER BY i.created_at DESC;

-- Everyone, with where they stand right now:
-- SELECT name, email, role,
--        CASE WHEN must_change_password THEN 'On a temporary password' WHEN password_hash IS NULL THEN 'No password yet' ELSE 'Own password' END AS password,
--        last_login_at AT TIME ZONE 'Asia/Kolkata' AS last_sign_in_ist
-- FROM users ORDER BY name;
