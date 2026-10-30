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

const lat = z.coerce.number().min(-90, "Not a latitude.").max(90, "Not a latitude.");
const lng = z.coerce.number().min(-180, "Not a longitude.").max(180, "Not a longitude.");
// Empty first: the number rules coerce, and Number(null) and Number("") are 0, which would turn "no location" into 0°N 0°E.
const optional = <T extends z.ZodTypeAny>(t: T) => z.union([z.null(), z.literal(""), t]).optional().transform((v) => (v === "" || v == null ? null : (v as z.infer<T>)));
/** The API takes pickup_lat or pickupLat (and the same for the others): the form sends the second, other callers may send the first. */
const SNAKE: Record<string, string> = { pickup_lat: "pickupLat", pickup_lng: "pickupLng", dropoff_lat: "dropoffLat", dropoff_lng: "dropoffLng", ride_id: "rideId" };
const camel = (v: unknown) => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [SNAKE[k] ?? k, x])) : v);
/** A point is both its latitude and its longitude, or neither. */
const pairs = (v: Record<string, unknown>, ctx: z.RefinementCtx, keys: [string, string][]) => {
  for (const [a, b] of keys) if ((v[a] == null) !== (v[b] == null)) ctx.addIssue({ code: "custom", message: "A location needs both its latitude and its longitude.", path: [a] });
};

export const rideInput = z.preprocess(camel, z.object({
  pickup: text("pickup point", 200),
  dropoff: text("drop-off point", 200),
  pickupLat: optional(lat), pickupLng: optional(lng), dropoffLat: optional(lat), dropoffLng: optional(lng),
  scheduledFor: z.string().transform((v, ctx) => {
    const d = istLocalToDate(v);
    if (!d) { ctx.addIssue({ code: "custom", message: "Choose the date and time of the ride." }); return z.NEVER; }
    const problem = scheduleProblem(d);
    if (problem) { ctx.addIssue({ code: "custom", message: problem }); return z.NEVER; }
    return d;
  }),
  notes: optionalText(500),
}).superRefine((v, ctx) => pairs(v, ctx, [["pickupLat", "pickupLng"], ["dropoffLat", "dropoffLng"]])));
export type RideInput = z.infer<typeof rideInput>;

/** The 4 digits the rider shows the driver. */
export const otpInput = z.object({ otp: z.string().trim().regex(/^\d{4}$/, "Enter the 4-digit OTP.") });

/**
 * A position from the driver's phone. Any driver_id in the body is ignored: the driver is whoever is signed in. Speed arrives in km/h;
 * heading in degrees. Accuracy, heading and speed are optional (phones often leave them out when standing still).
 */
export const locationInput = z.preprocess(camel, z.object({
  latitude: lat, longitude: lng,
  accuracy: optional(z.coerce.number().min(0).max(100_000)), heading: optional(z.coerce.number().min(0).max(360)), speed: optional(z.coerce.number().min(0).max(400)),
  rideId: z.union([idSchema, z.null(), z.literal("")]).optional().transform((v) => v || null),
}));

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

/* ------------------------------------------------------------ phase 3: maintenance, costs, invoices */

/**
 * Rupees as people type them ("1,250.50", "₹ 35") as whole paise; null when empty; "invalid" for anything else (negative, more than two
 * decimals, over ₹1 crore). The Cab Booking module's own: no other module's code is used.
 */
export function rupeesToPaise(raw: unknown): number | null | "invalid" {
  const t = String(raw ?? "").replace(/[₹,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "invalid";
  const paise = Math.round(Number(t) * 100);
  return paise > 1_00_00_000_00 ? "invalid" : paise;
}
const rupees = (required: boolean) => z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
  const p = rupeesToPaise(v);
  if (p === "invalid") { ctx.addIssue({ code: "custom", message: "Enter an amount in rupees, like 1250 or 1,250.50." }); return z.NEVER; }
  if (p === null && required) { ctx.addIssue({ code: "custom", message: "Enter the amount." }); return z.NEVER; }
  return p;
});

/** A calendar day ("YYYY-MM-DD") that really exists. */
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const day = (label: string) => z.string().trim().refine(isDay, `Choose the ${label}.`);
const optionalDay = (label: string) => z.union([z.string().trim(), z.null()]).optional().transform((v) => v || null).refine((v) => v === null || isDay(v), `Choose the ${label}.`);
/** A day as the start of that day in India. */
export const istDayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
/** Today in India, "YYYY-MM-DD". */
export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export const maintenanceInput = z.object({
  vehicleId: idSchema,
  type: z.enum(["service", "repair", "inspection", "cleaning", "other"], { message: "Choose the type." }),
  description: text("description", 500),
  cost: rupees(false),
  doneAt: day("date it was done"),
  doneBy: text("mechanic or service centre", 120),
  nextDueAt: optionalDay("next due date"),
  notes: optionalText(1000),
}).superRefine((v, ctx) => {
  if (v.nextDueAt && v.nextDueAt < v.doneAt) ctx.addIssue({ code: "custom", message: "The next due date can't be before the date it was done.", path: ["nextDueAt"] });
});
export type MaintenanceInput = z.infer<typeof maintenanceInput>;

export const costInput = z.object({
  fare: rupees(true),
  distanceKm: z.union([z.string(), z.number(), z.null()]).optional().transform((v, ctx) => {
    const t = String(v ?? "").trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0 || n > 100_000 || !/^\d+(\.\d{1,2})?$/.test(t)) { ctx.addIssue({ code: "custom", message: "Enter the distance in km, like 18.5." }); return z.NEVER; }
    return n;
  }),
  notes: optionalText(500),
});

export const invoiceInput = z.object({
  branch: text("branch", 100),
  periodStart: day("start of the period"),
  periodEnd: day("end of the period"),
  notes: optionalText(1000),
}).refine((v) => v.periodEnd >= v.periodStart, { message: "The period must end on or after its start.", path: ["periodEnd"] });
