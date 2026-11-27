-- Moves the Attendance office to its exact location and widens the check-in radius to 200 m (the same building: the basement parking has a
-- weaker GPS signal). Paste the whole file into the SQL Editor of the production database (Supabase, or Neon if DB_DRIVER is not "pg").
-- Data only: no table or column changes, no migration number used.
--
--   office  MCCIA Trade Tower, SB Road, Pune   lat 18.5355973   lng 73.8297353   radius 200 m
--
-- WHY THIS CHANGES ONLY THE OFFICE AND NOT THE WHOLE ROW
-- att_settings holds every Attendance setting in one JSON value (key "config"): the go-live date, the "first enabled on" date, which
-- Saturdays are off, the regularization window, reminders and more. Replacing the value with just {"office": ...} would erase all of
-- that (the go-live dates decide which days count as attendance). This merges instead: only the office is rewritten, and everything else in the
-- row is kept as it is.
--
-- WHAT IT DOES TO THE OFFICE
--   - name, lat, lng and radiusM are set. The radius is written as "radiusM", the key the Settings page and the app read first; a leftover
--     hand-written "radius" key is removed, because "radiusM" would win over it and the old 150 would silently stay in force.
--   - the office IP 49.248.67.194 is added to "allowedIps" only if neither "allowedIps" nor "officeIps" already has it. Nothing already listed
--     is removed or changed.
--   - if there is no "config" row at all, one is created with just the office and that IP (everything else then uses its defaults).
--
-- Safe to run more than once: the second run changes nothing (the IP is not added twice).
-- The code's built-in default office is the same place now, so a database with no office setting also lands here.
--
-- BEFORE YOU RUN IT: save what is there now, in case you want to go back:
--   SELECT value FROM att_settings WHERE key = 'config';
-- To go back, put the old office values (lat, lng, radiusM, name) in place of the new ones below and run it again.

INSERT INTO att_settings (key, value)
VALUES (
  'config',
  jsonb_build_object(
    'office', jsonb_build_object('name', 'MCCIA Trade Tower, SB Road, Pune', 'lat', 18.5355973, 'lng', 73.8297353, 'radiusM', 200),
    'allowedIps', jsonb_build_array('49.248.67.194')
  )
)
ON CONFLICT (key) DO UPDATE SET
  value = att_settings.value
    || jsonb_build_object('office', (COALESCE(att_settings.value->'office', '{}'::jsonb) - 'radius') || (EXCLUDED.value->'office'))
    || CASE
         WHEN jsonb_exists(COALESCE(att_settings.value->'allowedIps', '[]'::jsonb), EXCLUDED.value->'allowedIps'->>0)
           OR jsonb_exists(COALESCE(att_settings.value->'officeIps', '[]'::jsonb), EXCLUDED.value->'allowedIps'->>0)
         THEN '{}'::jsonb
         ELSE jsonb_build_object('allowedIps', COALESCE(att_settings.value->'allowedIps', '[]'::jsonb) || (EXCLUDED.value->'allowedIps'))
       END,
  updated_at = now();

-- Afterwards this should show the new office (lat 18.5355973, lng 73.8297353, radiusM 200, no "radius" key), the IP in one of the two lists,
-- and every other setting you had, unchanged:
-- SELECT value->'office' AS office, value->'allowedIps' AS allowed_ips, value->'officeIps' AS office_ips, value - 'office' AS everything_else
-- FROM att_settings WHERE key = 'config';
