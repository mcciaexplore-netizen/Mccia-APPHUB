import { requireCabsEnabled } from "@/lib/cabs/guard";

export const dynamic = "force-dynamic";

/**
 * Cab Booking is three sections, each a separate application in the hub with its own layout and sidebar: (staff) at /cabs, driver/ and
 * admin/. This wrapper only answers 404 for all of them while the module is switched off (CABS_ENABLED).
 */
export default function CabsRootLayout({ children }: { children: React.ReactNode }) {
  requireCabsEnabled();
  return children;
}
