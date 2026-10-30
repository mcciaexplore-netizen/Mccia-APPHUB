import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { InstallPrompt } from "@/components/InstallPrompt";
import { NavigationProgress } from "@/components/NavigationProgress";
import { Toaster } from "@/components/Toast";
import "./globals.css";
import { cn } from "@/lib/utils";

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
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <head>
        {/* The browser's install offer can come before the page has loaded its scripts: keep it so the Download buttons can use it. */}
        <script dangerouslySetInnerHTML={{ __html: `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__mcciaInstall=e;window.dispatchEvent(new Event("mccia-install-ready"));});` }} />
      </head>
      <body className="min-h-screen font-sans">
        <Suspense fallback={null}><NavigationProgress /></Suspense>
        <Toaster>{children}</Toaster>
        <InstallPrompt />
      </body>
    </html>
  );
}
