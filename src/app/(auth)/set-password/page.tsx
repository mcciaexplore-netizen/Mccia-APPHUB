import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requireSessionUser } from "@/lib/permissions";
import { signOut } from "@/lib/auth";
import { AnimatedGrid } from "@/components/AnimatedGrid";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Set your password · MCCIA App Hub" };

export default async function SetPasswordPage() {
  const user = await requireSessionUser();
  if (user.passwordHash) redirect("/"); // already has one; the gate in requireUser decides where to go next
  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-16">
      <AnimatedGrid />
      <div className="glass relative mx-auto w-full max-w-md animate-rise p-6 sm:p-10">
        <div className="icon-tile mx-auto mb-5"><KeyRound size={18} /></div>
        <h1 className="section-title text-center">Set your password</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Signed in as {user.email}. Choose a password so you can also sign in with your email later.
        </p>
        <SetPasswordForm
          signOutAction={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
          done={async () => {
            "use server";
            redirect("/");
          }}
        />
      </div>
    </main>
  );
}
