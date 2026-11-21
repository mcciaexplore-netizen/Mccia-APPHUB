import Link from "next/link";
import { redirect } from "next/navigation";
import { HubShell } from "@/components/HubShell";
import { requireSignedIn } from "@/lib/attendance/dal";
import { unreadNotices } from "@/lib/attendance/host-adapter";

export const metadata = { title: "Attendance · MCCIA App Hub" };

/** For someone who opened Attendance without being given the application. */
export default async function NoAccess() {
  const user = await requireSignedIn();
  if (user.member) redirect("/attendance");
  const unread = await unreadNotices(user.id);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="att-root mx-auto max-w-lg">
        <section className="att-card p-8 text-center">
          <h1 className="text-2xl text-ink">Attendance is not set up for you yet</h1>
          <p className="mt-3 text-[0.92rem] att-muted">
            Ask the Support Admin to give you the Attendance application in Administrator → Users. Until then there is nothing to show here.
          </p>
          <Link href="/" className="btn btn-primary mt-6 inline-flex">
            Back to the App Hub
          </Link>
        </section>
      </div>
    </HubShell>
  );
}
