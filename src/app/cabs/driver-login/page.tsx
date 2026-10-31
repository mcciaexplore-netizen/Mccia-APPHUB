import { redirect } from "next/navigation";
import { DriverLoginForm } from "@/components/cabs/DriverLoginForm";
import { SECTION_ROLES } from "@/lib/cabs/cabs.manifest";
import { hasAnyRole, resolveAccess } from "@/lib/cabs/host-adapter";

export const metadata = { title: "Driver Login · MCCIA Cabs" };

/**
 * Where drivers without a hub account sign in to Cabs Driver: their phone and a 6-digit OTP from a Cabs admin (Cabs Admin → Drivers →
 * Get Login OTP). Open to anyone; someone who can already open Cabs Driver goes straight there.
 */
export default async function DriverLoginPage() {
  const a = await resolveAccess();
  if (a.status === "ok" && hasAnyRole(a.user, SECTION_ROLES.driver)) redirect("/cabs/driver");
  return (
    <div className="flex min-h-dvh items-start justify-center bg-[#f0f2f5] px-4 pt-16 sm:items-center sm:pt-0">
      <main className="w-full max-w-[400px] space-y-6 rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        <div className="space-y-3 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo, the same file the hub serves */}
          <img src="/mccia-logo.png" alt="MCCIA" className="mx-auto h-10 w-auto" />
          <h1 className="text-2xl font-extrabold text-ink">Driver Login</h1>
        </div>
        <DriverLoginForm />
        <p className="text-center text-sm text-muted">Contact your admin if you need an OTP</p>
      </main>
    </div>
  );
}
