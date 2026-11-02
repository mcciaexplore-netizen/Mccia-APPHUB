import "server-only";
import { db } from "@/db";

/** The hub's database. DesignDesk keeps its own design_* tables in it (src/db/design-schema.ts). */
export { db };

/** db.execute() returns `{ rows }` on both production drivers; some return the array directly. */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] } | null)?.rows ?? []) as T[];
}
