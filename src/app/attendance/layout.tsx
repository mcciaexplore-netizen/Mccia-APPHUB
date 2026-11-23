import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { attEnabled } from "@/lib/attendance/flags";
import { THEME_SCRIPT, ThemeController } from "@/components/attendance/pwa/Theme";
import "./attendance.css";

export const dynamic = "force-dynamic";

/** "MCCIA People": Attendance installs as its own app (manifest /attendance/manifest.json, service worker /attendance-sw.js). */
export const metadata: Metadata = {
  manifest: "/attendance/manifest.json",
  appleWebApp: { capable: true, title: "MCCIA People", statusBarStyle: "default" },
  icons: { apple: "/icons/attendance-180.png" },
};

// Pinch-zoom stays on (people who need larger text can still zoom); inputs are 16px on phones, so iPhones do not zoom in on a tapped field.
// The browser bar: green, or black when the device is in dark mode (a choice made in Profile overrides it: Theme.tsx).
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#16A34A" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Attendance is two sections, each with its own layout: (staff) at /attendance (check in/out, leave, time, more) and admin/ (Attendance
 * Admin, for HR). This wrapper answers 404 for both while the module is switched off (ATT_ENABLED), loads the module's styles (att-) and
 * applies dark mode (components/attendance/pwa/Theme.tsx).
 */
export default function AttendanceRootLayout({ children }: { children: React.ReactNode }) {
  if (!attEnabled()) notFound();
  return (
    <>
      {/* Dark mode before the first paint (the person's choice, else the device's setting): no white flash. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <ThemeController />
      <ConfirmProvider>{children}</ConfirmProvider>
    </>
  );
}
