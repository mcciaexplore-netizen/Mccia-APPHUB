import { RolesView } from "@/components/inventory/RolesView";
import { requireRoleManager } from "@/lib/inventory/guard";
import { listRoleRows } from "@/lib/inventory/roles";

export const metadata = { title: "Settings · Inventory · MCCIA App Hub" };

/** Who runs the store. Inventory admins and the hub's Super Admin and Support Admin; anyone else gets "not found". */
export default async function SettingsPage() {
  const user = await requireRoleManager();
  return <div className="page-enter"><RolesView rows={await listRoleRows()} meId={user.id} /></div>;
}
