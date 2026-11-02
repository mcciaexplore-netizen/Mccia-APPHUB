import Image from "next/image";
import { notFound } from "next/navigation";
import { designEnabled } from "@/lib/design/flags";
import "../design/design.css";

export const dynamic = "force-dynamic";

/**
 * The two DesignDesk pages that work without signing in: /review/<token> (approve a design) and /track/<token> (follow a request). The
 * link itself is the key (see src/lib/design/tokens.ts); src/proxy.ts lets these addresses through without a hub session.
 */
export default function DesignPublicLayout({ children }: { children: React.ReactNode }) {
  if (!designEnabled()) notFound();
  return (
    <div className="ds-public">
      <header className="flex h-16 items-center gap-3 border-b border-[var(--ds-line)] bg-white px-5 sm:px-8">
        <Image src="/mccia-logo.png" alt="MCCIA" width={134} height={36} priority className="h-8 w-auto" />
        <span className="border-l border-[var(--ds-line)] pl-3 text-[0.68rem] font-bold uppercase tracking-widest text-[#003F8A]">Design Team</span>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
