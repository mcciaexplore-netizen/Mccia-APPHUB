import { config } from "dotenv";
import { and, eq, inArray, like } from "drizzle-orm";

config({ path: ".env.local" });
config();

// The hub's departments. Applications are added later from Settings, so none are seeded.
const DEPARTMENTS = [
  { name: "Finance", icon: "Wallet" },
  { name: "CRM", icon: "Handshake" },
  { name: "Creative", icon: "Sparkles" },
  { name: "Inventory", icon: "Package" },
  { name: "Safety Week", icon: "Shield" },
  { name: "Approval System", icon: "ClipboardList" },
] as const;

// Placeholder departments from the first version. They are deactivated (never deleted) if they only hold "Sample:" apps.
const LEGACY = ["Membership", "MSME Helpline", "Events"];

async function main() {
  // Import after env is loaded so src/db/index.ts sees DATABASE_URL.
  const { db } = await import("../src/db");
  const { apps, departments, users } = await import("../src/db/schema");
  const { slugify } = await import("../src/lib/validation");

  // Head admin: created if missing. There is no sign-in, so no password is set.
  const email = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.HEAD_ADMIN_NAME?.trim() || "Head Admin";
  if (!email) throw new Error("HEAD_ADMIN_EMAIL is required");

  let [admin] = await db.select().from(users).where(eq(users.email, email));
  if (!admin) {
    [admin] = await db.insert(users).values({ name, email, role: "head_admin" }).returning();
    console.log(`Created head admin ${email}`);
  } else console.log(`Head admin ${email} already exists`);


  // Departments, in the order given.
  let order = 0;
  for (const d of DEPARTMENTS) {
    order += 10;
    const [dep] = await db.select().from(departments).where(eq(departments.name, d.name));
    if (!dep) {
      await db.insert(departments).values({ name: d.name, slug: slugify(d.name), icon: d.icon, sortOrder: order });
      console.log(`Created department ${d.name}`);
    } else {
      await db.update(departments).set({ sortOrder: order, slug: dep.slug ?? slugify(d.name), isActive: true }).where(eq(departments.id, dep.id));
    }
  }

  // Retire the old placeholder data.
  const legacy = await db.select().from(departments).where(inArray(departments.name, LEGACY));
  for (const dep of legacy) {
    const real = await db.select({ id: apps.id }).from(apps).where(and(eq(apps.departmentId, dep.id)));
    const sample = await db.select({ id: apps.id }).from(apps).where(and(eq(apps.departmentId, dep.id), like(apps.name, "Sample:%")));
    if (real.length === sample.length) {
      if (sample.length) await db.update(apps).set({ isActive: false }).where(inArray(apps.id, sample.map((a) => a.id)));
      await db.update(departments).set({ isActive: false, sortOrder: 1000 }).where(eq(departments.id, dep.id));
      console.log(`Deactivated old sample department ${dep.name}`);
    } else console.log(`Left ${dep.name} alone: it has real applications`);
  }
  // Sample apps that sit in Finance (from the first version) are also hidden.
  const stray = await db.select({ id: apps.id }).from(apps).where(like(apps.name, "Sample:%"));
  if (stray.length) await db.update(apps).set({ isActive: false }).where(inArray(apps.id, stray.map((a) => a.id)));

  console.log("Seed complete");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
