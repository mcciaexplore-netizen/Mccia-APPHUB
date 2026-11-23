import { NextResponse } from "next/server";
import { attEnabled } from "@/lib/attendance/flags";

// The web app manifest of "MCCIA People" (Attendance as an installable app, opening at /attendance). Served without a sign-in (the proxy lets
// this one address through: browsers fetch manifests without cookies), and it holds nothing private. 404 while Attendance is switched off.
export const dynamic = "force-dynamic";

const MANIFEST = {
  id: "/attendance",
  name: "MCCIA People",
  short_name: "MCCIA People",
  description: "Attendance and leave management",
  start_url: "/attendance",
  scope: "/attendance",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#16A34A",
  // Dark mode's colours, where the browser supports per-scheme manifest colours (Chromium's user_preferences); the page's own
  // <meta name="theme-color"> follows dark mode everywhere else.
  user_preferences: { color_scheme_dark: { theme_color: "#111827", background_color: "#111827" } },
  orientation: "portrait",
  icons: [
    { src: "/icons/attendance-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/attendance-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/attendance-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
  shortcuts: [
    { name: "Check in", url: "/attendance", icons: [{ src: "/icons/attendance-192.png", sizes: "192x192" }] },
    { name: "Apply leave", url: "/attendance/leave/apply", icons: [{ src: "/icons/attendance-192.png", sizes: "192x192" }] },
  ],
};

export function GET() {
  if (!attEnabled()) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(JSON.stringify(MANIFEST), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
