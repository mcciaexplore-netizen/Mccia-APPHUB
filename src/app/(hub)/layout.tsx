import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/permissions";
import { getPendingUserCount, getVisibleDepartments } from "@/lib/access";
import { HubShell } from "@/components/HubShell";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  // Login is required for everything in the hub.
  const user = await requireUser();
  const [departments, pendingUsers] = await Promise.all([
    getVisibleDepartments(user),
    // Head admins are told how many sign-ups are waiting for a decision.
    user.role === "head_admin" ? getPendingUserCount() : Promise.resolve(0),
  ]);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <HubShell
      user={{ name: user.name, role: user.role, pendingUsers }}
      departments={departments}
      signOutAction={signOutAction}
    >
      {children}
    </HubShell>
  );
}
