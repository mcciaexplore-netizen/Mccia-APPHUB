import { notFound } from "next/navigation";
import { after } from "next/server";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { eruEnabled } from "@/lib/eru/flags";
import { runIfDue } from "@/lib/eru/jobs";
import "./eru.css";

export const dynamic = "force-dynamic";

/**
 * ERU is two sections, each with its own layout and sidebar: (workspace) at /eru (domains, projects, the document editor) and admin/ (ERU
 * Admin). This wrapper answers 404 for both while the module is switched off (ERU_ENABLED), loads the module's styles (all prefixed eru-), and
 * runs the background clean-up after the page is sent when it is due.
 */
export default function EruRootLayout({ children }: { children: React.ReactNode }) {
  if (!eruEnabled()) notFound();
  after(runIfDue);
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
