import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/Toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "MCCIA App Hub",
  description: "One front office for every MCCIA application.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <Toaster>{children}</Toaster>
      </body>
    </html>
  );
}
