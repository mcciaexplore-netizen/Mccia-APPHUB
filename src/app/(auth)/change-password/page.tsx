import Link from "next/link";
import { KeyRound } from "lucide-react";
import { isEnvAdmin } from "@/lib/auth";
import { requireUser } from "@/lib/permissions";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata = { title: "Change password · MCCIA App Hub" };

export default async function ChangePasswordPage() {
  const user = await requireUser();
  const managedInEnv = isEnvAdmin(user.email);
  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="glass w-full max-w-md animate-rise p-6 sm:p-10">
        <div className="icon-tile mx-auto mb-5"><KeyRound size={18} /></div>
        <h1 className="section-title text-center">Change password</h1>
        <p className="mt-2 text-center text-sm text-muted">Signed in as {user.email}.</p>
        {managedInEnv ? (
          <p className="alert mt-6 text-left">This account&apos;s password is set in the environment settings (<code>HEAD_ADMIN_PASSWORD</code>). Change it there and redeploy.</p>
        ) : (
          <ChangePasswordForm />
        )}
        <p className="mt-4 text-center text-sm"><Link href="/" className="text-muted hover:text-primary">Back to the hub</Link></p>
      </div>
    </main>
  );
}
