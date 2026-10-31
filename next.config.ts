import type { NextConfig } from "next";

// Cab Booking's map and address search read NEXT_PUBLIC_GEOAPIFY_API_KEY, which is fixed into the site when it is built. Say at build time
// whether it was there: its length and last 4 characters, never the whole key.
{
  const key = (process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY ?? "").trim();
  console.log(key ? `[cabs] NEXT_PUBLIC_GEOAPIFY_API_KEY is set (${key.length} characters, ending …${key.slice(-4)})` : "[cabs] NEXT_PUBLIC_GEOAPIFY_API_KEY is NOT set: address suggestions will search OpenStreetMap on Enter, and maps use OpenStreetMap tiles");
}

/**
 * Content-Security-Policy, sent in REPORT-ONLY mode for now: the browser logs anything that breaks it in the console but blocks nothing.
 * Everything the hub loads comes from itself (the font is bundled at build time), except Geoapify for Cab Booking: its map tiles
 * (maps.geoapify.com, then OpenStreetMap's, then CARTO's) and its address search (api.geoapify.com, then OpenStreetMap's Nominatim). 'unsafe-inline' scripts are needed by Next.js's own
 * inline scripts (and the small install-offer script in the root layout); 'unsafe-eval' only in development, for hot reload.
 * Once no violations show, rename the header to Content-Security-Policy to enforce it.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://maps.geoapify.com https://tile.openstreetmap.org https://*.basemaps.cartocdn.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.geoapify.com https://nominatim.openstreetmap.org",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Do not announce the framework (X-Powered-By: Next.js) to visitors.
  poweredByHeader: false,
  // The bulk-add screen checks up to 2,000 people in one request; the default 1 MB limit would stop a large file.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // IVR-CRM's PDF reports: the renderer loads its fonts and layout engine from node_modules at run time, so it stays out of the bundle.
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy-Report-Only", value: csp },
          // The hub uses no camera, microphone or payments: switch them off for every page. Location only for the hub's own pages: Cab
          // Booking's "Use my location" and the driver's live position.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()" },
        ],
      },
      // The single sign-on hand-off page carries a signed token in its body: no Referer at all, not even the hub's address. (A header set here wins
      // over one set by the route, and a later entry wins over the one above, so this has to be here and not only in the route.)
      { source: "/launch/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
