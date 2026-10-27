/**
 * Seeds a SCRATCH database for trying single sign-on end to end (the hub here, the MCCIA Search app on http://127.0.0.1:3001). It REFUSES to run
 * unless DATABASE_URL points at this machine (localhost or 127.0.0.1). It never reads .env or .env.local, so it cannot reach the live database.
 * Safe to run again: everything is matched by email, name or slug and brought back to the values below (passwords are reset too).
 *
 * What it makes (password for all three people: Test-pass-1!, approved, active, no password change asked):
 *   Normal User  normal@test.local      member, has MCCIA Search, role "user"
 *   App Admin    appadmin@test.local    member, has MCCIA Search, role "admin"
 *   No Access    noaccess@test.local    member, has no application
 *   department "SSO Test Apps" with
 *     MCCIA Search  single sign-on ON, slug mccia-search, url http://127.0.0.1:3001, callback http://127.0.0.1:3001/api/sso/callback
 *     Plain App     an ordinary application (no single sign-on), opened through /go as before; Normal User and App Admin have it
 * The Support Admin (a head admin, always an "admin" in every single sign-on app) is not a row: it is set by the environment of the hub you run
 * (SUPPORT_ADMIN_EMAIL, SUPPORT_ADMIN_NAME, SUPPORT_ADMIN_PASSWORD), and its row is created the first time it signs in.
 *
 * Exact commands (run from this folder; the postgres tools are in /opt/homebrew/opt/postgresql@17/bin on a Mac with Homebrew):
 *   1. A scratch Postgres on port 55432 (once):
 *        initdb -D /tmp/hub-sso-db -U postgres --auth=trust
 *        pg_ctl -D /tmp/hub-sso-db -o "-p 55432 -h 127.0.0.1" -l /tmp/hub-sso-db/log start
 *        createdb -h 127.0.0.1 -p 55432 -U postgres hub_sso
 *   2. The tables, then this seed:
 *        DATABASE_URL=postgres://postgres@127.0.0.1:55432/hub_sso DB_DRIVER=pg npx drizzle-kit migrate
 *        DATABASE_URL=postgres://postgres@127.0.0.1:55432/hub_sso npm run db:seed:sso
 *   3. A key pair (the hub signs with the private one; MCCIA Search verifies with the public one), then the hub on http://localhost:3000:
 *        node scripts/sso-keygen.mjs ~/sso-keys
 *        DATABASE_URL=postgres://postgres@127.0.0.1:55432/hub_sso DB_DRIVER=pg AUTH_SECRET="$(openssl rand -hex 32)" \
 *          SSO_PRIVATE_KEY="$(cat ~/sso-keys/sso-private.b64)" APP_BASE_URL=http://localhost:3000 \
 *          SUPPORT_ADMIN_EMAIL=support@test.local SUPPORT_ADMIN_NAME="Support Admin" SUPPORT_ADMIN_PASSWORD='Test-pass-1!' npm run dev
 *      Always give DATABASE_URL on the command line like this: a value set there beats one in a .env file that `next dev` would otherwise load.
 *   4. Sign in at http://localhost:3000 as any of the people above (or support@test.local) and open the MCCIA Search card.
 *   Stop and delete the scratch database when done:  pg_ctl -D /tmp/hub-sso-db stop && rm -rf /tmp/hub-sso-db
 */
import { and, eq } from "drizzle-orm";

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
const PASSWORD = "Test-pass-1!";
const APP_URL = "http://127.0.0.1:3001";
const SLUG = "mccia-search";

function assertScratch(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set. Point it at a scratch Postgres on this machine (see the top of this file).");
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid address.");
  }
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`Refusing to seed ${host}: this script only runs against localhost or 127.0.0.1, never a real database.`);
  return host;
}

async function main() {
  const host = assertScratch();
  process.env.DB_DRIVER = "pg"; // the neon driver cannot talk to a local Postgres
  const port = new URL(process.env.DATABASE_URL!).port || "5432";
  console.log(`Seeding the scratch database at ${host}:${port}`);

  // Import after the guard, so nothing opens a connection before it has passed.
  const { db } = await import("../src/db");
  const { apps, departments, userAppAccess, users } = await import("../src/db/schema");
  const { hashPassword } = await import("../src/lib/passwords");

  const passwordHash = await hashPassword(PASSWORD);
  const person = async (name: string, email: string) => {
    const values = { name, email, role: "member" as const, passwordHash, mustChangePassword: false, isActive: true, status: "approved" as const, signupSource: "admin" };
    const [u] = await db.insert(users).values(values).onConflictDoUpdate({ target: users.email, set: values }).returning({ id: users.id });
    return u.id;
  };
  const [normal, appAdmin] = await Promise.all([person("Normal User", "normal@test.local"), person("App Admin", "appadmin@test.local"), person("No Access", "noaccess@test.local")]);

  await db.insert(departments).values({ kind: "application", name: "SSO Test Apps", icon: "Building2" }).onConflictDoNothing();
  const [dept] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.kind, "application"), eq(departments.name, "SSO Test Apps")));
  await db.update(departments).set({ isActive: true }).where(eq(departments.id, dept.id));

  const app = async (name: string, values: Partial<typeof apps.$inferInsert> & { url: string }) => {
    const row = { departmentId: dept.id, name, icon: "Globe", isActive: true, status: "active" as const, ...values };
    const [have] = await db.select({ id: apps.id }).from(apps).where(and(eq(apps.departmentId, dept.id), eq(apps.name, name)));
    if (have) {
      await db.update(apps).set(row).where(eq(apps.id, have.id));
      return have.id;
    }
    const [made] = await db.insert(apps).values(row).returning({ id: apps.id });
    return made.id;
  };
  const [holder] = await db.select({ id: apps.id, name: apps.name }).from(apps).where(eq(apps.ssoSlug, SLUG));
  if (holder && holder.name !== "MCCIA Search") throw new Error(`The slug ${SLUG} already belongs to "${holder.name}" in this database. Use a clean scratch database.`);
  const search = await app("MCCIA Search", {
    description: "Single sign-on test application", url: APP_URL, sortOrder: 10,
    ssoEnabled: true, ssoSlug: SLUG, ssoCallbackUrl: `${APP_URL}/api/sso/callback`,
  });
  const plain = await app("Plain App", { description: "An ordinary application without single sign-on", url: "https://example.com", sortOrder: 20, ssoEnabled: false, ssoSlug: null, ssoCallbackUrl: null });

  const grant = (userId: string, appId: string, appRole: "user" | "admin") =>
    db.insert(userAppAccess).values({ userId, appId, appRole }).onConflictDoUpdate({ target: [userAppAccess.userId, userAppAccess.appId], set: { appRole } });
  await grant(normal, search, "user");
  await grant(appAdmin, search, "admin");
  await grant(normal, plain, "user");
  await grant(appAdmin, plain, "user");

  console.log(`Done. Password for all three people: ${PASSWORD}`);
  console.log("  normal@test.local (user), appadmin@test.local (admin), noaccess@test.local (no access)");
  console.log(`  MCCIA Search: /launch/${SLUG} -> ${APP_URL}/api/sso/callback`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "seed failed");
  process.exit(1);
});
