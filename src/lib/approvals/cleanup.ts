import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/** How long an upload may wait to be attached to a request before it is deleted. A form left open over lunch still works. */
const ORPHAN_AFTER_HOURS = 24;

/**
 * Deletes uploads that were never attached to a request (the person closed the form, or the upload was abandoned), older than
 * ORPHAN_AFTER_HOURS. Their parts go with them (apr_file_chunks cascades). A file any request points at is never touched, even if its
 * "attached" flag were wrong. Returns how many files and bytes were removed.
 */
export async function deleteOrphanUploads(): Promise<{ files: number; bytes: number }> {
  const res = (await db.execute(sql`
    delete from apr_files f
    where f.attached = false
      and f.created_at < now() - make_interval(hours => ${ORPHAN_AFTER_HOURS})
      and not exists (select 1 from apr_attachments a where a.storage_key = f.id::text)
    returning f.size`)) as unknown as { rows: { size: number }[] };
  return { files: res.rows.length, bytes: res.rows.reduce((n, r) => n + Number(r.size), 0) };
}
