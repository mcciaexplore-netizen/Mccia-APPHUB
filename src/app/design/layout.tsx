import { notFound } from "next/navigation";
import { after } from "next/server";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { designEnabled } from "@/lib/design/flags";
import { runIfDue } from "@/lib/design/jobs";
import "./design.css";

export const dynamic = "force-dynamic";

/**
 * DesignDesk is three sections, each with its own layout and sidebar: (team) at /design (Design Team Forms), admin/ (Design Admin), and
 * (requester) for the request pages every hub user can open. This wrapper answers 404 for all of them while the module is switched off
 * (DESIGN_ENABLED), loads the module's styles (all prefixed ds-), and runs the scheduled jobs after the page is sent when they are due.
 */
export default function DesignRootLayout({ children }: { children: React.ReactNode }) {
  if (!designEnabled()) notFound();
  after(runIfDue);
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
