import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";

config({ path: ".env.local" });
config();

/** The expenditure categories seen in the current Zoho dropdown, spelled correctly. */
const CATEGORIES = [
  "Admin Expenses", "AEFC", "Books & Periodicals", "Certificate of Origin", "Commission paid", "Communication", "Digitization",
  "Exhibition and Conference", "Housekeeping expenses", "Insurance", "Leadership Development Program - IIMA", "Learning and Development",
  "Legal and professional fees", "Marketing", "MCCIA Recording Studio", "MCCIA Youth Fellowship 2024 - Hiring Process", "Meeting expenses",
  "Membership Certificate Frames", "Membership Meet", "Membership renewal", "Membership to Organisation", "MIDC Sub-Letting Charges",
  "Miscellaneous expenses", "Office expenses", "Office Revamp", "Other", "Payments to auditors", "Power and fuel", "Printing and stationery",
  "Programs Activities", "Publication", "Rates and Taxes", "Repairs and Maintenance", "Safety", "Security Charges", "Travel Expense",
  "Travelling and conveyance", "Website expenses", "Workshop on AI Tools for Employees", "Workshop on use of AI Tools for Employees",
];

/** Likely duplicates in the Zoho list: both are kept, and flagged so an admin can merge them. */
const DUPLICATE_GROUPS: Record<string, string> = {
  "Travel Expense": "travel",
  "Travelling and conveyance": "travel",
  "Workshop on AI Tools for Employees": "ai-tools-workshop",
  "Workshop on use of AI Tools for Employees": "ai-tools-workshop",
};

/** Misspellings in Zoho, kept as aliases so old records still map to the right category. */
const ALIASES: Record<string, string[]> = {
  "Leadership Development Program - IIMA": ["Leadership Develeopment Program - IIMA"],
  Marketing: ["Marketting"],
};

const HR_CATEGORIES = ["Experience Certificate", "Letter Draft (Offer Letter)", "Certificate", "Circular", "Celebration", "Expenses"];

/** Who handles what, by email (they must already be users in the hub): see APPROVALS_*_EMAIL in .env.example. */
const RULES = [
  { type: "hr", stepNo: 1, label: "Reviewer", who: "APPROVALS_HR_APPROVER_EMAIL" },
  { type: "hr", stepNo: 2, label: "Director General", who: "APPROVALS_DG_EMAIL" },
  { type: "expenditure_large", stepNo: 1, label: "Reviewer", who: "APPROVALS_EXPENDITURE_APPROVER_EMAIL" },
  { type: "expenditure_large", stepNo: 2, label: "Director General", who: "APPROVALS_DG_EMAIL" },
  { type: "expenditure_small", stepNo: 1, label: "Reviewer", who: "APPROVALS_EXPENDITURE_APPROVER_EMAIL" },
] as const;

/**
 * Fills the approvals masters, settings and routing rules. Safe to run again: it only adds what is missing and never overwrites
 * anything an admin has changed (a routing rule that already has an approver is left alone).
 */
async function main() {
  // Import after env is loaded so src/db/index.ts sees DATABASE_URL.
  const { db } = await import("../src/db");
  const { users } = await import("../src/db/schema");
  const { aprApproverRules, aprCategories, aprHrCategories, aprSettings } = await import("../src/db/approvals-schema");

  const added = await db
    .insert(aprCategories)
    .values(CATEGORIES.map((name) => ({ name, aliases: ALIASES[name] ?? [], duplicateGroup: DUPLICATE_GROUPS[name] ?? null })))
    .onConflictDoNothing()
    .returning({ id: aprCategories.id });
  console.log(`Expense categories: ${added.length} added, ${CATEGORIES.length - added.length} already there`);

  const hrAdded = await db
    .insert(aprHrCategories)
    .values(HR_CATEGORIES.map((name, i) => ({ name, sort: i + 1 })))
    .onConflictDoNothing()
    .returning({ id: aprHrCategories.id });
  console.log(`HR categories: ${hrAdded.length} added, ${HR_CATEGORIES.length - hrAdded.length} already there`);

  const threshold = Number(process.env.APPROVALS_THRESHOLD_PAISE);
  await db
    .insert(aprSettings)
    .values([
      { key: "threshold_paise", value: String(Number.isSafeInteger(threshold) && threshold > 0 ? threshold : 1_000_000) },
      { key: "reminder_after_hours", value: "48" },
      { key: "large_form_show_quotation", value: "true" },
    ])
    .onConflictDoNothing();
  console.log("Settings: defaults in place");

  const person = new Map<string, string | null>();
  for (const key of new Set(RULES.map((r) => r.who))) {
    const email = process.env[key]?.trim().toLowerCase();
    if (!email) { person.set(key, null); console.warn(`  ${key} is not set, so that step has no approver yet`); continue; }
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.isActive, true)));
    person.set(key, u?.id ?? null);
    if (!u) console.warn(`  ${key}=${email} is not an active user of the hub yet, so that step has no approver yet`);
  }

  let created = 0, filled = 0;
  for (const r of RULES) {
    const approver = person.get(r.who) ?? null;
    const [made] = await db
      .insert(aprApproverRules)
      .values({ requestType: r.type, stepNo: r.stepNo, stepLabel: r.label, approverUserIds: approver ? [approver] : [] })
      .onConflictDoNothing()
      .returning({ id: aprApproverRules.id });
    if (made) { created++; continue; }
    if (!approver) continue;
    const [fill] = await db
      .update(aprApproverRules)
      .set({ approverUserIds: [approver] })
      .where(and(eq(aprApproverRules.requestType, r.type), eq(aprApproverRules.stepNo, r.stepNo), sql`cardinality(${aprApproverRules.approverUserIds}) = 0`))
      .returning({ id: aprApproverRules.id });
    if (fill) filled++;
  }
  console.log(`Routing rules: ${created} created, ${filled} given an approver, ${RULES.length - created - filled} left as they were`);

  console.log("Approvals seed complete");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
