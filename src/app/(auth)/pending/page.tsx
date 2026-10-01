import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { requireSessionUser } from "@/lib/permissions";
import { signOut } from "@/lib/auth";
import { AnimatedGrid } from "@/components/AnimatedGrid";

export const metadata = { title: "Waiting for approval · MCCIA App Hub" };
export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const user = await requireSessionUser();
  if (!user.passwordHash) redirect("/set-password");
  if (user.status === "approved") redirect("/");
  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-16">
      <AnimatedGrid />
      <div className="glass relative mx-auto w-full max-w-md animate-rise p-6 text-center sm:p-10">
        <div className="icon-tile mx-auto mb-5"><Clock size={18} /></div>
        <h1 className="section-title">Waiting for approval</h1>
        <p className="mt-3 text-sm text-muted">
          Your request for <b>{user.email}</b> has been sent to the administrator. You can use the hub once it is accepted,
          and the administrator will then give you access to the applications you need.
        </p>
        <p className="mt-3 text-sm text-muted">Come back later and sign in again to check.</p>
        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="btn btn-ghost w-full">Sign out</button>
        </form>
      </div>
    </main>
  );
}
