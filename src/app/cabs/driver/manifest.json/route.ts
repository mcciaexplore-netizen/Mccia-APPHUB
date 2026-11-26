import { NextResponse } from "next/server";
import { cabsEnabled } from "@/lib/cabs/flags";

// The web app manifest of "MCCIA Driver" (Cabs Driver as its own installable app, opening at /cabs/driver; its scope also covers the
// driver's sign-in page, /cabs/driver-login). Without it, installing from a driver page installed the whole App Hub. Served without a
// sign-in (the proxy lets this one address through: browsers fetch manifests without cookies), and it holds nothing private. 404 while
// Cab Booking is switched off.
export const dynamic = "force-dynamic";

const MANIFEST = {
  id: "/cabs/driver",
  name: "MCCIA Driver",
  short_name: "MCCIA Driver",
  description: "Cab rides for MCCIA drivers",
  start_url: "/cabs/driver",
  scope: "/cabs/driver",
  display: "standalone",
  background_color: "#f0f2f5",
  theme_color: "#F59E0B",
  orientation: "portrait",
  icons: [
    { src: "/icons/cabs-driver-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/cabs-driver-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/cabs-driver-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function GET() {
  if (!cabsEnabled()) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(JSON.stringify(MANIFEST), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
}
