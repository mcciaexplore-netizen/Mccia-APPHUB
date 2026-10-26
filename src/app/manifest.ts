import type { MetadataRoute } from "next";

/** Lets people install the hub as an app on their computer (Chrome, Edge) or phone (Android, and iPhone through Add to Home Screen). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MCCIA App Hub",
    short_name: "MCCIA Hub",
    description: "One front office for every MCCIA application.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2a6b7c",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
