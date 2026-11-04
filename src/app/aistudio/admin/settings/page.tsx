import { eq } from "drizzle-orm";
import { SettingsView } from "@/components/aistudio/admin/SettingsView";
import { PageHeader } from "@/components/aistudio/ui";
import { settings } from "@/db/aistudio-schema";
import { requireLead } from "@/lib/aistudio/dal";
import { db } from "@/lib/aistudio/db";

export const metadata = { title: "Settings · AI Studio Admin" };

/** Settings (AI Studio leads; "Delete all data" for the Support Admin only). */
export default async function SettingsPage() {
  const u = await requireLead();
  const [s] = await db.select({ hook: settings.slackWebhook }).from(settings).where(eq(settings.id, 1)).limit(1);
  return (
    <div>
      <PageHeader title="Settings" />
      <SettingsView slackWebhook={s?.hook ?? ""} superAdmin={u.superAdmin} />
    </div>
  );
}
