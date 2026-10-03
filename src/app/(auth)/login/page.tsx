import { redirect } from "next/navigation";
import { AlertCircle, LayoutGrid } from "lucide-react";
import { login } from "@/actions/auth";
import { getCurrentUser } from "@/lib/permissions";
import { safeNext } from "@/lib/session";

export const metadata = { title: "Sign in · MCCIA App Hub" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const dest = safeNext(next);
  if (await getCurrentUser()) redirect(dest);

  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="glass w-full max-w-md animate-rise p-6 text-center sm:p-10">
        <div className="icon-tile mx-auto mb-5"><LayoutGrid size={18} /></div>
        <h1 className="section-title">MCCIA App Hub</h1>
        <p className="mt-2 text-sm text-muted">Sign in to open your applications.</p>

        {error && (
          <div role="alert" className="alert alert-red mt-6 text-left">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>Incorrect email or password.</span>
          </div>
        )}

        <form action={login} className="mt-7 space-y-3 text-left">
          <input type="hidden" name="next" value={dest} />
          <label className="block">
            <span className="label-xs mb-1.5 block">Email</span>
            <input name="email" type="text" inputMode="email" className="input" autoComplete="username" required autoFocus />
          </label>
          <label className="block">
            <span className="label-xs mb-1.5 block">Password</span>
            <input name="password" type="password" className="input" autoComplete="current-password" required />
          </label>
          <button type="submit" className="btn btn-primary w-full">Sign in</button>
        </form>
        <p className="mt-5 text-xs text-subtle">Accounts are created by the administrator.</p>
      </div>
    </main>
  );
}
