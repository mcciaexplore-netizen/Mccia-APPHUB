import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The frame of the rider and driver apps (in place of the hub's top bar): a white top bar with the way back to the hub, the MCCIA logo and
 * the app's name, and whatever goes on its right (the rider's avatar, the driver's Online switch). Light grey behind white cards. No way
 * back to the hub for a driver signed in by phone (`hubLink` false), who has no hub account.
 */
export function CabsTopBar({ label, right, narrow = false, hubLink = true }: { label: string; right?: React.ReactNode; narrow?: boolean; hubLink?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-white">
      <div className={`mx-auto flex h-16 items-center gap-3 px-4 ${narrow ? "max-w-[480px]" : "max-w-6xl"}`}>
        {hubLink && (
          <Link href="/" className="-ml-1 inline-flex min-h-12 items-center gap-0.5 rounded-md pr-1 text-xs text-muted transition-colors hover:text-[#2a6b7c]" aria-label="Back to the App Hub">
            <ChevronLeft size={18} aria-hidden /><span className="hidden sm:inline">App Hub</span>
          </Link>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo, the same file the hub serves */}
        <img src="/mccia-logo.png" alt="MCCIA" className="h-7 w-auto" />
        <span className="border-l border-black/10 pl-3 text-sm font-medium text-muted">{label}</span>
        <div className="ml-auto flex items-center">{right}</div>
      </div>
    </header>
  );
}

/** Initials in a circle: "Asha Kulkarni" → "AK". */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#2a6b7c] font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials}
    </span>
  );
}
