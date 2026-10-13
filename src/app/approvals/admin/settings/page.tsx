import { PageHeader } from "@/components/approvals/PageHeader";
import { SettingsForm } from "@/components/approvals/SettingsForm";
import { requirePage } from "@/lib/approvals/guard";
import { getSettings } from "@/lib/approvals/settings";

export const metadata = { title: "Settings · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  return (
    <>
      <PageHeader title="Settings" intro="The values the module runs on. Changing them never alters requests that are already in progress." />
      <SettingsForm initial={await getSettings()} />
    </>
  );
}
