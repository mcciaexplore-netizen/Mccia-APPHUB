import type { Metadata } from "next";

/**
 * "MCCIA Driver": Cabs Driver installed as its own app on a driver's phone (its own name, taxi icon and home-screen entry, opening at
 * /cabs/driver), not the whole App Hub. Its pages (the driver app and its sign-in page) point at its own manifest; the install offer on
 * those pages is the driver app's (components/InstallPrompt.tsx).
 */
export const DRIVER_APP_META: Pick<Metadata, "manifest" | "appleWebApp" | "icons"> = {
  manifest: "/cabs/driver/manifest.json",
  appleWebApp: { capable: true, title: "MCCIA Driver", statusBarStyle: "default" },
  icons: { apple: "/icons/cabs-driver-180.png" },
};

/** The addresses that belong to the driver app: the app itself and its sign-in page. */
export const isDriverAppPath = (path: string) => path === "/cabs/driver" || path.startsWith("/cabs/driver/") || path === "/cabs/driver-login";
