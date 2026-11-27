-- Makes the Supabase Storage bucket "avatars" that holds the App Hub profile photos. Paste into the Supabase SQL Editor (or make the bucket by
-- hand in Storage > New bucket, with "Public bucket" on). Safe to run more than once.
--
--   public          anyone with a photo's address can see it (the hub shows photos in its header and lists; the addresses are random and are
--                   only ever shown to people signed in to the hub).
--   2 MB, images    the bucket itself refuses anything over 2 MB or that is not a JPEG, PNG or WebP picture (the hub checks both too).
--
-- WHO MAY UPLOAD: only the hub's own server. People never write to the bucket directly: they send the picture to the hub, which checks who
-- they are and saves it under their own id (avatars/<their id>/...), and changes only their own profile. No storage policy that lets
-- "authenticated" or "anon" write is made here, and none should be added: without one, Supabase refuses any write that does not come with
-- the service_role key, which only the hub's server has (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, the same settings as DesignDesk's files).
--
-- To use a different bucket name, set AVATAR_STORAGE_BUCKET in Vercel and use that name here.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Afterwards this should show one row: avatars | true | 2097152
-- SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'avatars';
