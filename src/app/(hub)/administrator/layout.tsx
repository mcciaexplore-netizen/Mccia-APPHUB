import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireHeadAdmin } from "@/lib/permissions";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { AdminNav } from "./AdminNav";

export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  await requireHeadAdmin();
  const [{ n: pendingUsers }] = await db.select({ n: count() }).from(users).where(eq(users.status, "pending"));
  return (
    <ConfirmProvider>
      <h1 className="text-3xl sm:text-4xl">Administrator</h1>
      <AdminNav pendingUsers={pendingUsers} />
      {children}
    </ConfirmProvider>
  );
}
