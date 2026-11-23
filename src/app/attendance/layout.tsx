import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { attEnabled } from "@/lib/attendance/flags";
import "./attendance.css";

export const dynamic = "force-dynamic";

/** "MCCIA People": Attendance installs as its own app (manifest /attendance/manifest.json, service worker /attendance-sw.js). */
export const metadata: Metadata = {
  manifest: "/attendance/manifest.json",
  appleWebApp: { capable: true, title: "MCCIA People", statusBarStyle: "default" },
  icons: { apple: "/icons/attendance-180.png" },
};

// Pinch-zoom stays on (people who need larger text can still zoom); inputs are 16px on phones, so iPhones do not zoom in on a tapped field.
export const viewport: Viewport = { themeColor: "#16A34A", width: "device-width", initialScale: 1, viewportFit: "cover" };

/**
 * Attendance is two sections, each with its own layout: (staff) at /attendance (check in/out, leave, time, more) and admin/ (Attendance
 * Admin, for HR). This wrapper answers 404 for both while the module is switched off (ATT_ENABLED) and loads the module's styles (att-).
 */
export default function AttendanceRootLayout({ children }: { children: React.ReactNode }) {
  if (!attEnabled()) notFound();
  return <ConfirmProvider>{children}</ConfirmProvider>;
}
