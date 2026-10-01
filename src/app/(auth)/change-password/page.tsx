import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requireSessionUser } from "@/lib/permissions";
import { signOut } from "@/lib/auth";
import { AnimatedGrid } from "@/components/AnimatedGrid";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata = { title: "Change password · MCCIA App Hub" };

export default async function ChangePasswordPage() {
  const user = await requireSessionUser();
  const forced = user.mustChangePassword;
  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-16">
      <AnimatedGrid />
      <div className="glass relative mx-auto w-full max-w-md animate-rise p-6 sm:p-10">
        <div className="icon-tile mx-auto mb-5"><KeyRound size={18} /></div>
        <h1 className="section-title text-center">{forced ? "Set a new password" : "Change password"}</h1>
        <p className="mt-2 text-center text-sm text-muted">
          {forced ? "Your administrator gave you a temporary password. Choose your own to continue." : `Signed in as ${user.email}.`}
        </p>
        <ChangePasswordForm
          cancelHref={forced ? null : "/"}
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
