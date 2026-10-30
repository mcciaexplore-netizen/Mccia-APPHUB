/**
 * The pure rules behind ride OTPs and navigation (no database), so the unit tests can check them: when an OTP expires, how many tries it
 * allows, and the Google Maps link the driver gets once the OTP is right.
 */

export const OTP_MAX_ATTEMPTS = 3;
const TWO_HOURS = 2 * 3600_000;

/** 2 hours after the ride's scheduled time, and never sooner than 2 hours from now (a ride booked for later keeps a usable code). */
export const otpExpiry = (scheduledFor: Date, now = Date.now()) => new Date(Math.max(scheduledFor.getTime() + TWO_HOURS, now + TWO_HOURS));

type Place = { text: string; lat: number | null; lng: number | null };
const point = (p: Place) => (p.lat != null && p.lng != null ? `${p.lat},${p.lng}` : p.text);

/** Google Maps directions from pickup to drop-off: coordinates when the ride has them, otherwise the addresses as typed. */
export function mapsLink(pickup: Place, dropoff: Place): string {
  const q = new URLSearchParams({ api: "1", origin: point(pickup), destination: point(dropoff), travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${q}`;
}

/** Turns a numeric column (read back as text) into a number, or null. */
export const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
