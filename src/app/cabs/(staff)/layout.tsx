import Link from "next/link";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { Avatar, CabsTopBar } from "@/components/cabs/CabsShell";
import { CabsSidebar } from "@/components/cabs/CabsSidebar";
import { RideAlertsWatcher } from "@/components/cabs/RideAlerts";
import { requireCabsPage } from "@/lib/cabs/guard";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "MCCIA Cabs · MCCIA App Hub" };

/**
 * The rider app (MCCIA Cabs), in its own frame like the MCCIA Cabs app: a white top bar (back to the hub, the logo, "Cabs", the person's
 * initials, which open Account), the menu on the left from a laptop up and along the bottom on a phone, light grey behind white cards.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [, user] = await Promise.all([requireUser(), requireCabsPage()]);
  return (
    <ConfirmProvider>
      <div className="min-h-dvh bg-[#f5f5f5]">
        <CabsTopBar label="Cabs" right={<Link href="/cabs/account" className="rounded-full" aria-label="Your account"><Avatar name={user.name} /></Link>} />
        <div className="mx-auto flex max-w-6xl gap-6 px-4 pb-28 pt-6 lg:pb-10">
          <CabsSidebar roles={user.roles} />
          <main className="page-slot min-w-0 flex-1">{children}</main>
        </div>
        <RideAlertsWatcher />
      </div>
    </ConfirmProvider>
  );
}
