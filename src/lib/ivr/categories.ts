import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { callCategories, type CallCategory } from "@/db/ivr-schema";

export const DEFAULT_CATEGORIES: { key: string; label: string; appliesTo: "inbound" | "outbound" | "both"; ivrKey?: string }[] = [
  { key: "membership", label: "Membership", appliesTo: "both", ivrKey: "1" },
  { key: "membership_enquiry", label: "Membership enquiry", appliesTo: "both", ivrKey: "2" },
  { key: "proforma", label: "Proforma invoice", appliesTo: "both", ivrKey: "3" },
  { key: "event_paid_info", label: "Event (paid info)", appliesTo: "both", ivrKey: "4" },
  { key: "hall_booking", label: "Hall booking", appliesTo: "both", ivrKey: "5" },
  { key: "booking_confirmation", label: "Booking confirmation", appliesTo: "both" },
  { key: "confirmation_call", label: "Confirmation call", appliesTo: "outbound" },
  { key: "poc_change", label: "POC change", appliesTo: "both" },
  { key: "other", label: "Other", appliesTo: "both" },
];

/** Insert the default categories when the table is empty. Safe to call repeatedly. */
export async function ensureCategories(): Promise<void> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(callCategories);
  if (n > 0) return;
  await db
    .insert(callCategories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ key: c.key, label: c.label, appliesTo: c.appliesTo, ivrKey: c.ivrKey ?? null, sort: i })))
    .onConflictDoNothing({ target: callCategories.key });
}

export async function listCategories(opts: { activeOnly?: boolean } = {}): Promise<CallCategory[]> {
  await ensureCategories();
  const q = db.select().from(callCategories);
  const rows = await (opts.activeOnly ? q.where(eq(callCategories.active, true)) : q).orderBy(asc(callCategories.sort), asc(callCategories.label));
  return rows;
}

/** Category for an inbound caller's IVR menu key. */
export async function categoryForIvrKey(dtmf: string | null | undefined): Promise<CallCategory | null> {
  if (!dtmf) return null;
  const key = dtmf.trim().slice(-1);
  if (!key) return null;
  const rows = await listCategories({ activeOnly: true });
  return rows.find((c) => c.ivrKey === key && c.appliesTo !== "outbound") ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Match a category written in an import file (by label or key, or a clear prefix) to a known category. */
export function matchCategoryText(list: CallCategory[], text: string | null | undefined): CallCategory | null {
  const t = norm(text ?? "");
  if (!t) return null;
  const exact = list.find((c) => norm(c.label) === t || norm(c.key) === t);
  if (exact) return exact;
  const loose = list.filter((c) => norm(c.label).includes(t) || t.includes(norm(c.label)));
  return loose.length === 1 ? loose[0] : null;
}
