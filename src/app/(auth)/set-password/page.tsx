import Link from "next/link";
import { KeyRound, TriangleAlert } from "lucide-react";
import { inviteInfo } from "@/lib/invites";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Set your password · MCCIA App Hub", referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const who = await inviteInfo(token);
  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="glass w-full max-w-md animate-rise p-6 sm:p-10">
        {who ? (
          <>
            <div className="icon-tile mx-auto mb-5"><KeyRound size={18} /></div>
            <h1 className="text-center text-2xl">Choose your password</h1>
            <p className="mt-2 text-center text-sm text-muted">Welcome, {who.name}. This sets the password for {who.email}.</p>
            <SetPasswordForm token={token} />
          </>
        ) : (
          <>
            <div className="icon-tile mx-auto mb-5"><TriangleAlert size={18} /></div>
            <h1 className="text-center text-2xl">This link cannot be used</h1>
            <p className="mt-2 text-center text-sm text-muted">It may have expired, or it was already used. Ask your administrator to send you a new one.</p>
            <p className="mt-6 text-center text-sm"><Link href="/login" className="text-primary hover:underline">Go to sign in</Link></p>
          </>
        )}
      </div>
    </main>
  );
}
