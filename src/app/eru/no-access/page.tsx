import Link from "next/link";
import { redirect } from "next/navigation";
import { HubShell } from "@/components/HubShell";
import { requireSignedIn } from "@/lib/eru/dal";
import { unreadNotices } from "@/lib/eru/host-adapter";

export const metadata = { title: "ERU · MCCIA App Hub" };

/** For someone who opened ERU but is not on its team (given the application, but on neither of its lists). */
export default async function NoAccess() {
  const user = await requireSignedIn();
  if (user.member) redirect("/eru");
  const unread = await unreadNotices(user.id);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="eru-root mx-auto max-w-lg">
        <section className="eru-card p-8 text-center">
          <h1 className="text-2xl text-ink">You are not on the ERU team yet</h1>
          <p className="mt-3 text-[0.92rem] eru-muted">
            ERU is the Economic Research Unit&apos;s workspace. An ERU admin can add you on the Members page of ERU Admin; until then there is nothing to show here.
          </p>
          <Link href="/" className="btn btn-primary mt-6 inline-flex">
            Back to the App Hub
          </Link>
        </section>
      </div>
    </HubShell>
  );
}
