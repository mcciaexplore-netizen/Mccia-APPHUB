import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/permissions";
import { getVisibleDepartments } from "@/lib/access";
import { HubShell } from "@/components/HubShell";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  // Login is required for everything in the hub.
  const user = await requireUser();
  const departments = await getVisibleDepartments(user);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <HubShell
      user={{ name: user.name, role: user.role }}
      departments={departments}
      signOutAction={signOutAction}
    >
      {children}
    </HubShell>
  );
}
