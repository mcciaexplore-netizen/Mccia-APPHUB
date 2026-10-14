import { Lato } from "next/font/google";
import "@/components/approvals/approvals.css";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { Shell } from "@/components/approvals/Shell";
import { requirePage } from "@/lib/approvals/guard";
import { logout } from "@/lib/approvals/host-adapter";
import { unreadCount } from "@/lib/approvals/notify";
import { waitingCount } from "@/lib/approvals/request-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals · MCCIA App Hub" };

const lato = Lato({ weight: ["400", "700", "900"], subsets: ["latin"], variable: "--font-lato", display: "swap" });

export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage();
  const [unread, waiting] = await Promise.all([unreadCount(user.id), waitingCount(user)]);
  return (
    <div className={lato.variable}>
      <ConfirmProvider>
        <Shell user={{ name: user.name, roles: user.roles }} unread={unread} waiting={waiting} signOut={logout}>{children}</Shell>
      </ConfirmProvider>
    </div>
  );
}
