import "server-only";
import { db } from "@/db";

/** The hub's database. AI Studio keeps its own aistudio_* tables in it (src/db/aistudio-schema.ts). */
export { db };

/** db.execute() returns `{ rows }` on both production drivers; some return the array directly. */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] } | null)?.rows ?? []) as T[];
}
