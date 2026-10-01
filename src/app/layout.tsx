import type { Metadata } from "next";
import { Bricolage_Grotesque, Outfit } from "next/font/google";
import { Toaster } from "@/components/Toast";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
});
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "MCCIA App Hub",
  description: "One front office for every MCCIA application.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${outfit.variable}`}>
      <body className="min-h-screen font-sans">
        <Toaster>{children}</Toaster>
      </body>
    </html>
  );
}
