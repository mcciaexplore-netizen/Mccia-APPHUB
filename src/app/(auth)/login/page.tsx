import { redirect } from "next/navigation";
import { AlertCircle, LayoutGrid } from "lucide-react";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { getCurrentUser } from "@/lib/permissions";
import { AnimatedGrid } from "@/components/AnimatedGrid";

const ERRORS: Record<string, string> = {
  NotInvited: "You do not have access. Contact the administrator.",
  BadCredentials: "Incorrect email or password.",
  Locked: "Too many failed attempts. Please wait 15 minutes and try again, or ask the administrator to reset your password.",
  Deactivated: "Your account has been deactivated. Contact the administrator.",
  WrongDomain: "Please use your MCCIA organisation account.",
};

export const metadata = { title: "Sign in · MCCIA App Hub" };

const googleEnabled = () => !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-16">
      <AnimatedGrid />
      <div className="relative w-full max-w-[1140px]">
        <div className="glass mx-auto w-full max-w-md animate-rise p-6 text-center sm:p-10">
          <div className="icon-tile mx-auto mb-5"><LayoutGrid size={18} /></div>
          <h1 className="section-title">MCCIA App Hub</h1>
          <p className="mt-2 text-sm text-muted">Sign in to open your applications.</p>

          {message && (
            <div role="alert" className="alert alert-red mt-6 text-left">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <form
            className="mt-7 space-y-3 text-left"
            action={async (fd: FormData) => {
              "use server";
              try {
                await signIn("credentials", { email: fd.get("email"), password: fd.get("password"), redirectTo: "/" });
              } catch (e) {
                if (e instanceof AuthError) {
                  const locked = (e as { code?: string }).code === "Locked";
                  redirect(`/login?error=${locked ? "Locked" : "BadCredentials"}`);
                }
                throw e; // lets the success redirect through
              }
            }}
          >
            <label className="block">
              <span className="label-xs mb-1.5 block">Email</span>
              <input name="email" type="text" inputMode="email" className="input" autoComplete="username" required />
            </label>
            <label className="block">
              <span className="label-xs mb-1.5 block">Password</span>
              <input name="password" type="password" className="input" autoComplete="current-password" required />
            </label>
            <button type="submit" className="btn btn-primary w-full">Sign in</button>
          </form>

          {googleEnabled() && (
            <form
              className="mt-4 border-t border-line pt-4"
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button type="submit" className="btn btn-ghost w-full">Continue with Google</button>
            </form>
          )}
          <p className="mt-5 text-xs text-subtle">Accounts are created by the administrator.</p>
        </div>
      </div>
    </main>
  );
}
