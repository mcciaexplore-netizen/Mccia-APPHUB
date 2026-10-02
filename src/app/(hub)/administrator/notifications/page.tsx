import { Bell } from "lucide-react";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Notifications · MCCIA App Hub" };

/** Placeholder: the section exists and is reachable; notifications themselves are not built yet. */
export default async function Page() {
  await requireHeadAdmin();
  return (
    <div className="glass mx-auto max-w-xl p-8 text-center">
      <div className="icon-tile mx-auto mb-4"><Bell size={18} /></div>
      <h2 className="text-2xl">Notifications Panel</h2>
      <p className="mt-2 text-sm text-muted">There are no notifications yet. Alerts for administrators will appear here once they are added.</p>
    </div>
  );
}
