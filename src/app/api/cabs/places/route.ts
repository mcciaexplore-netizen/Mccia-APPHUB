import { z } from "zod";
import { CabsError } from "@/lib/cabs/errors";
import { ok, route } from "@/lib/cabs/guard";
import { addressAt, searchPlaces } from "@/lib/cabs/places";

export const dynamic = "force-dynamic";

const query = z.union([
  z.object({ q: z.string().trim().min(2).max(120), more: z.enum(["1"]).optional() }),
  z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }),
]);

/**
 * The booking form's address search (see src/lib/cabs/places.ts): ?q= suggestions as the person types (Photon, Pune first), ?q=&more=1
 * a deliberate search (also Nominatim), ?lat=&lng= the address at a position. 502 when no address service answers, so the form can fall
 * back to its own search.
 */
export const GET = route({ roles: ["cab_user", "cab_admin"] }, async ({ req }) => {
  const p = query.parse(Object.fromEntries(req.nextUrl.searchParams));
  if ("lat" in p) return ok({ address: await addressAt(p.lat, p.lng) });
  try {
    return ok({ places: await searchPlaces(p.q, p.more === "1") });
  } catch {
    throw new CabsError("Address search is not available right now. You can keep what you typed.", 502);
  }
});
