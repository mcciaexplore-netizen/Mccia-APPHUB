import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, Lock } from "lucide-react";
import { logout, unlockAdmin } from "@/actions/auth";
import { requireUser } from "@/lib/permissions";
import { safeNext } from "@/lib/session";

export const metadata = { title: "Unlock Administrator · MCCIA App Hub" };

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const user = await requireUser();
  if (user.role !== "head_admin") redirect("/");
  const { error, next } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="glass w-full max-w-md animate-rise p-6 text-center sm:p-10">
        <div className="icon-tile mx-auto mb-5"><Lock size={18} /></div>
        <h1 className="section-title">Administrator is locked</h1>
        <p className="mt-2 text-sm text-muted">Enter the password for <b>{user.email}</b> to open it. It locks again when you leave.</p>

        {error && (
          <div role="alert" className="alert alert-red mt-6 text-left">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>Incorrect password.</span>
          </div>
        )}

        <form action={unlockAdmin} className="mt-7 space-y-3 text-left">
          <input type="hidden" name="next" value={safeNext(next)} />
          <label className="block">
            <span className="label-xs mb-1.5 block">Password</span>
            <input name="password" type="password" className="input" autoComplete="current-password" required autoFocus />
          </label>
          <button type="submit" className="btn btn-primary w-full">Unlock</button>
        </form>
        <div className="mt-4 flex justify-center gap-4 text-sm">
          <Link href="/" className="text-muted hover:text-primary">Back to the hub</Link>
          <form action={logout}><button className="text-muted hover:text-primary">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
