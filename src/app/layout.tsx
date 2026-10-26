import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { InstallPrompt } from "@/components/InstallPrompt";
import { Toaster } from "@/components/Toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

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
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <Toaster>{children}</Toaster>
        <InstallPrompt />
      </body>
    </html>
  );
}
