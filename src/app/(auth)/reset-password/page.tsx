import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { resetLinkValid } from "@/lib/password-reset";
import { ResetPasswordForm } from "./ResetPasswordForm";

// The link's secret is in the address: never send it on as a Referer.
export const metadata = { title: "Set new password · MCCIA App Hub", referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/** Open to everyone (see src/proxy.ts): the secret in the link is the key. src/lib/password-reset.ts checks it. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const valid = await resetLinkValid(token);
  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="glass w-full max-w-md animate-rise p-6 text-center sm:p-10">
        <Image src="/mccia-logo.png" alt="MCCIA" width={179} height={48} priority className="mx-auto mb-5 h-12 w-auto" />
        <h1 className="section-title">Set new password</h1>
        <ResetPasswordForm token={valid ? token : ""} valid={valid} />
        <p className="mt-6 text-sm">
          <Link href="/login" className="inline-flex items-center gap-1 text-primary hover:underline"><ArrowLeft size={14} aria-hidden /> Back to login</Link>
        </p>
      </div>
    </main>
  );
}
