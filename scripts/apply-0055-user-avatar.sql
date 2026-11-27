-- Applies migration 0055 (profile photos: users.avatar_url) to the live database, by hand. Paste the whole file into the SQL Editor of the
-- database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and run it BEFORE the
-- code on feat/hub-profile-dark-mode is deployed (the pages read the new column, so the code must not go first).
--
-- Additive only, and safe to run more than once:
--   - the users table gains one nullable column, avatar_url: the public address of a person's profile photo (empty for everyone today, so
--     everyone keeps showing their initials until they add a photo). No existing row or column is changed.
--   - the code running in production today never mentions it, so it keeps working, and so does Instant Rollback.
--
-- The photos themselves live in a Supabase Storage bucket called "avatars": make it with scripts/create-avatars-bucket.sql.
--
-- To undo it (this forgets every photo's address; the files stay in the bucket):
--   ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '2cf7795b57c7572f2604a648c2417c2781f2d53b329ebe33023b1f3b9fcec382';

BEGIN;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '2cf7795b57c7572f2604a648c2417c2781f2d53b329ebe33023b1f3b9fcec382', 1795759073319
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '2cf7795b57c7572f2604a648c2417c2781f2d53b329ebe33023b1f3b9fcec382');

COMMIT;

-- Afterwards this should return 1 and 1:
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'avatar_url') AS new_column,
--        (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash = '2cf7795b57c7572f2604a648c2417c2781f2d53b329ebe33023b1f3b9fcec382') AS recorded;
