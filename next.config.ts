import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not announce the framework (X-Powered-By: Next.js) to visitors.
  poweredByHeader: false,
  // The bulk-add screen checks up to 2,000 people in one request; the default 1 MB limit would stop a large file.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The hub uses no camera, microphone, location or payments: switch them off for every page.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
