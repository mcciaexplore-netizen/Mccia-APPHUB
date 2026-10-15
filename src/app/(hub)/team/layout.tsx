import { ConfirmProvider } from "@/components/ConfirmDialog";
import { requireTeamManager } from "@/lib/permissions";

/** For team managers: the people in their team or reporting to them. The head admin uses Administrator instead. */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  await requireTeamManager();
  return (
    <ConfirmProvider>
      <h1 className="mb-6 text-2xl sm:text-3xl">My team</h1>
      {children}
    </ConfirmProvider>
  );
}
