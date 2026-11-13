import { SettingsView } from "@/components/eru/admin/SettingsView";
import { PageHeader } from "@/components/eru/ui";
import { requireAdmin } from "@/lib/eru/dal";
import { settingsView } from "@/lib/eru/queries";

export const metadata = { title: "Settings · ERU Admin · MCCIA App Hub" };

export default async function Settings() {
  const u = await requireAdmin();
  const s = await settingsView();
  return (
    <div>
      <PageHeader title="Settings" subtitle="Domains and general settings." />
      <SettingsView domains={s.domains} trackChangesDefault={s.trackChangesDefault} superAdmin={u.superAdmin} />
    </div>
  );
}
