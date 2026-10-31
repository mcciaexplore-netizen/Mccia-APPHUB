import { notFound } from "next/navigation";
import { ivrEnabled } from "@/lib/ivr/flags";
import "./ivr.css";

export const dynamic = "force-dynamic";

/**
 * IVR-CRM is two sections, each a separate application in the hub with its own layout and sidebar: (agent) at /ivr and admin/. This
 * wrapper only answers 404 for both while the module is switched off (IVR_ENABLED), and loads the module's few styles (all prefixed ivr-).
 */
export default function IvrRootLayout({ children }: { children: React.ReactNode }) {
  if (!ivrEnabled()) notFound();
  return children;
}
