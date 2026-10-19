import Link from "next/link";
import { requireAdministrator } from "@/lib/permissions";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { adminTabsFor } from "@/lib/admin-tabs";
import { SETUP_GROUP_LABEL, approvalsApps, isGroup } from "@/lib/approvals/approvals.manifest";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { isSuper } from "@/lib/rbac";

/** The Approval System's settings screens (Who Approves What, Expense Types, ...), read from its menu data. */
const APPROVAL_SETTINGS = approvalsApps.flatMap((a) => a.nav).flatMap((e) => (isGroup(e) && e.label === SETUP_GROUP_LABEL ? e.items : []));

const card = "card-lift glass !rounded-md px-4 py-3 text-sm font-bold text-ink";

/**
 * Administrator's sections as cards under its heading, on every Administrator page, and for the Support Admin a second row with the
 * Approval System's settings: everything that is set up lives here, not in the Approval System.
 */
export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdministrator();
  return (
    <ConfirmProvider>
      <h1 className="mb-6 text-3xl sm:text-4xl">Administrator</h1>
      <nav aria-label="Administrator" className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {adminTabsFor(me).map((t) => <Link key={t.href} href={t.href} className={card}>{t.label}</Link>)}
      </nav>
      {isSuper(me) && approvalsEnabled() && (
        <nav aria-label="Approval System settings" className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-subtle">Approval System settings</h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {APPROVAL_SETTINGS.map((l) => <Link key={l.href} href={l.href!} className={card}>{l.label}</Link>)}
          </div>
        </nav>
      )}
      {children}
    </ConfirmProvider>
  );
}
