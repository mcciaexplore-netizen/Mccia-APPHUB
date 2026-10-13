import "@/components/approvals/approvals.css";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { Shell } from "@/components/approvals/Shell";
import { requirePage } from "@/lib/approvals/guard";
import { logout } from "@/lib/approvals/host-adapter";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals · MCCIA App Hub" };

export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage();
  return (
    <ConfirmProvider>
      <Shell user={{ name: user.name, roles: user.roles }} signOut={logout}>{children}</Shell>
    </ConfirmProvider>
  );
}
