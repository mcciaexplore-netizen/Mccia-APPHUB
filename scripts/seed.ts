import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local" });
config();

/**
 * Creates the head admin named in the environment if it does not exist yet. Departments, apps and users are all
 * added afterwards from Administrator, so nothing else is seeded. Safe to run again.
 */
async function main() {
  // Import after env is loaded so src/db/index.ts sees DATABASE_URL.
  const { db } = await import("../src/db");
  const { users } = await import("../src/db/schema");

  const email = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.HEAD_ADMIN_NAME?.trim();
  if (!email) throw new Error("HEAD_ADMIN_EMAIL is required");
  if (!name) throw new Error("HEAD_ADMIN_NAME is required");

  const [admin] = await db.select().from(users).where(eq(users.email, email));
  if (admin) console.log(`Head admin ${email} already exists`);
  else {
    await db.insert(users).values({ name, email, role: "head_admin" });
    console.log(`Created head admin ${email}`);
  }

  console.log("Seed complete");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
