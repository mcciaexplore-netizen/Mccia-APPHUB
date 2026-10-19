import Link from "next/link";
import { requireAdministrator } from "@/lib/permissions";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { adminTabsFor } from "@/lib/admin-tabs";

/** Administrator's sections as a row of cards under its heading, on every Administrator page (there is no sidebar menu any more). */
export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdministrator();
  return (
    <ConfirmProvider>
      <h1 className="mb-6 text-3xl sm:text-4xl">Administrator</h1>
      <nav aria-label="Administrator" className="mb-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {adminTabsFor(me).map((t) => (
          <Link key={t.href} href={t.href} className="card-lift glass !rounded-md px-4 py-3 text-sm font-bold text-ink">{t.label}</Link>
        ))}
      </nav>
      {children}
    </ConfirmProvider>
  );
}
