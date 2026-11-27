import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { DriverInstallPrompt } from "@/components/DriverInstallPrompt";
import { HubThemeController } from "@/components/HubTheme";
import { NavigationProgress } from "@/components/NavigationProgress";
import { Toaster } from "@/components/Toast";
import { HUB_THEME_SCRIPT } from "@/lib/hub-theme-rules";
import "./globals.css";

// Served from the hub itself (no request to Google), preloaded, and shown in a fallback font sized to match until it arrives, so the text
// is readable at once and does not jump when it swaps.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap", preload: true });

export const metadata: Metadata = {
  title: "MCCIA App Hub",
  description: "One front office for every MCCIA application.",
  // Installed on an iPhone or iPad (Add to Home Screen) it opens full screen, with this name and icon.
  appleWebApp: { capable: true, title: "MCCIA Hub", statusBarStyle: "default" },
  icons: { apple: "/apple-icon.png" },
};

export const viewport: Viewport = { themeColor: "#2a6b7c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: Attendance adds its dark-mode class to <html> before React starts (only that attribute is exempt).
    <html lang="en" className={`font-sans ${geist.variable}`} suppressHydrationWarning>
      <head>
        {/* Dark mode before the first paint (the person's choice, else the device's setting): no white flash. Not on the pages that keep their own look. */}
        <script dangerouslySetInnerHTML={{ __html: HUB_THEME_SCRIPT }} />
        {/* The browser's install offer can come before the page has loaded its scripts: keep it so the install buttons (MCCIA People's "Install App", the driver app's Download) can use it. */}
        <script dangerouslySetInnerHTML={{ __html: `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__mcciaInstall=e;window.dispatchEvent(new Event("mccia-install-ready"));});` }} />
      </head>
      <body className="min-h-screen font-sans">
        <HubThemeController />
        <Suspense fallback={null}><NavigationProgress /></Suspense>
        <Toaster>{children}</Toaster>
        <DriverInstallPrompt />
      </body>
    </html>
  );
}
