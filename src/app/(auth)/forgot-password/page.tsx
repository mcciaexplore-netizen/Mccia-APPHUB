import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Reset your password · MCCIA App Hub" };

/** Open to everyone (see src/proxy.ts): the email is only sent to an account that exists, and the answer never says which. */
export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-16">
      <div className="glass w-full max-w-md animate-rise p-6 text-center sm:p-10">
        <Image src="/mccia-logo.png" alt="MCCIA" width={179} height={48} priority className="mx-auto mb-5 h-12 w-auto" />
        <h1 className="section-title">Reset your password</h1>
        <p className="mt-2 text-sm text-muted">Enter your MCCIA email and we&apos;ll send you a reset link.</p>
        <ForgotPasswordForm />
        <p className="mt-6 text-sm">
          <Link href="/login" className="inline-flex items-center gap-1 text-primary hover:underline"><ArrowLeft size={14} aria-hidden /> Back to login</Link>
        </p>
      </div>
    </main>
  );
}
