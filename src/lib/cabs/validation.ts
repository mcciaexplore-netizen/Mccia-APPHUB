import { z } from "zod";

/** Input rules for the Cab Booking module, shared by its forms and its API routes. */

export const idSchema = z.string().uuid();

/** How far in the past a ride may still be booked (a form left open for a few minutes), and how far ahead. */
export const PAST_GRACE_MS = 5 * 60_000;
export const MAX_AHEAD_DAYS = 365;

/**
 * A date and time as the booking form sends it ("2026-11-02T09:30", from a datetime-local input), read as India time. A full ISO time with
 * its own offset is accepted as it is. Null when it is not a real date and time.
 */
export function istLocalToDate(raw: string): Date | null {
  const s = raw.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  const d = local ? new Date(`${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6] ?? "00"}+05:30`) : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Why a ride cannot be booked for this time, or null when it can. */
export function scheduleProblem(when: Date, now = Date.now()): string | null {
  if (when.getTime() < now - PAST_GRACE_MS) return "Choose a time that has not passed yet.";
  if (when.getTime() > now + MAX_AHEAD_DAYS * 86_400_000) return "Rides can be booked up to a year ahead.";
  return null;
}

const text = (label: string, max: number) => z.string().trim().min(1, `Enter the ${label}.`).max(max, `The ${label} can be at most ${max} characters.`);
const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters.`).optional().nullable().transform((v) => (v ? v : null));

export const rideInput = z.object({
  pickup: text("pickup point", 200),
  dropoff: text("drop-off point", 200),
  scheduledFor: z.string().transform((v, ctx) => {
    const d = istLocalToDate(v);
    if (!d) { ctx.addIssue({ code: "custom", message: "Choose the date and time of the ride." }); return z.NEVER; }
    const problem = scheduleProblem(d);
    if (problem) { ctx.addIssue({ code: "custom", message: problem }); return z.NEVER; }
    return d;
  }),
  notes: optionalText(500),
});
export type RideInput = z.infer<typeof rideInput>;

export const assignInput = z.object({ driverId: idSchema, vehicleId: idSchema });

/** A reason: required when an admin cancels (checked in bookings.ts), optional when the person cancels their own ride. */
export const cancelInput = z.object({ reason: optionalText(300) });

/** A number plate as people type it ("mh 12 ab 1234") kept in one form: capitals, single spaces. */
export const normalisePlate = (v: string) => v.trim().toUpperCase().replace(/\s+/g, " ");

export const vehicleInput = z.object({
  numberPlate: z.string().transform(normalisePlate).pipe(z.string().min(4, "Enter the number plate.").max(20, "The number plate can be at most 20 characters.")),
  model: text("model", 80),
  capacity: z.coerce.number().int("Seats must be a whole number.").min(1, "At least 1 seat.").max(50, "At most 50 seats."),
});
export const vehicleUpdate = vehicleInput.partial().extend({ isActive: z.boolean().optional() });

const optionalId = z.union([idSchema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));

/** A phone number as people type it, kept as its digits (with a leading + when given). */
export const normalisePhone = (v: string) => { const t = v.trim(); return (t.startsWith("+") ? "+" : "") + t.replace(/\D/g, ""); };

export const driverInput = z.object({
  name: text("name", 100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  phone: z.string().transform(normalisePhone).pipe(z.string().regex(/^\+?\d{10,15}$/, "Enter a phone number of 10 to 15 digits.")),
  vehicleId: optionalId,
});
export const driverUpdate = z.object({ vehicleId: optionalId });
export const availabilityInput = z.object({ available: z.boolean() });
