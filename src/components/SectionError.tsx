"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** The digest Next.js gives a server error (also in the server's log), shown so the Support Admin can find it; never the message itself. */
const digestOf = (error: unknown) => (error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null);

/**
 * What a page shows when it fails, inside the frame it was opened in: the hub's top bar and the application's own menu stay, so the person
 * can try again or go somewhere else without losing their place. `retry` loads the page again from the server.
 */
export function SectionError({ error, retry, home = "/", homeLabel = "App Hub" }: { error: unknown; retry: () => void; home?: string; homeLabel?: string }) {
  const digest = digestOf(error);
  return (
    <div role="alert" data-section-error className="mx-auto w-full max-w-md rounded-[14px] border border-line bg-white p-8 text-center">
      <div className="icon-tile mx-auto mb-4 !border-red-tint-line !bg-red-tint !text-brand-red"><AlertTriangle size={18} /></div>
      <h2 className="text-2xl">This page could not be loaded</h2>
      <p className="mt-2 text-sm text-muted">Please try again. If it keeps happening, contact the Support Admin{digest ? " and quote the reference below" : ""}.</p>
      {digest && <p className="mt-2 font-mono text-xs text-subtle">Reference: {digest}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <button type="button" onClick={() => retry()} className="btn btn-primary">Try again</button>
        <Link href={home} className="btn btn-ghost">{homeLabel}</Link>
      </div>
    </div>
  );
}
