import { notFound } from "next/navigation";
import { after } from "next/server";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { aistudioEnabled } from "@/lib/aistudio/flags";
import { runIfDue } from "@/lib/aistudio/jobs";
import "./aistudio.css";

export const dynamic = "force-dynamic";

/**
 * AI Studio is two sections, each with its own layout and sidebar: (requester) at /aistudio (AI Studio: the request form and the person's
 * own requests) and admin/ (AI Studio Admin: the team). This wrapper answers 404 for both while the module is switched off
 * (AISTUDIO_ENABLED), loads the module's styles (all prefixed ai-), and runs the background jobs after the page is sent when they are due.
 */
export default function AiStudioRootLayout({ children }: { children: React.ReactNode }) {
  if (!aistudioEnabled()) notFound();
  after(runIfDue);
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
