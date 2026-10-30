import { boolean, char, decimal, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Cab Booking module tables. Every table and type is prefixed cab_ and nothing here touches a hub table.
 * People are referenced by user id WITHOUT a foreign key, the same as Inventory and Approvals: the hub can delete users, and ride history
 * must outlive them. Each row that names a person keeps a snapshot of their name (and, where mail goes to them, their email). Drivers are
 * not tied to a hub account at all: they are a name, an email and a phone number (see cabDrivers).
 *
 * A ride's status only ever moves forward, by single conditional statements (the production driver has no transactions):
 *   pending → assigned → in_progress → completed, and pending or assigned → cancelled.
 * Assigning a ride makes a 4-digit OTP (cab_ride_otps) that the rider shows the driver; the driver entering it is what starts the ride.
 * While a ride is under way the driver's phone sends its position (cab_driver_locations, kept 24 hours) for the admins' fleet map.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** A latitude or longitude: 7 decimal places is about a centimetre. Read back as text by the driver; the code turns it into a number. */
const coord = (name: string) => decimal(name, { precision: 10, scale: 7 });

export const cabRideStatus = pgEnum("cab_ride_status", ["pending", "assigned", "in_progress", "completed", "cancelled"]);

/** The fleet. A vehicle is deactivated, never deleted, so past rides keep naming it. */
export const cabVehicles = pgTable("cab_vehicles", {
  id: id(),
  numberPlate: text("number_plate").notNull().unique(),
  model: text("model").notNull(),
  capacity: integer("capacity").notNull().default(4),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/**
 * Drivers, added on Cabs Admin → Drivers: a name, an email (kept lower case, one driver per email) and a phone number. A driver need not
 * have a hub account. Someone signed in to the hub whose email is a driver's opens Cabs Driver; that is the only link between the two.
 */
export const cabDrivers = pgTable("cab_drivers", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  vehicleId: uuid("vehicle_id").references(() => cabVehicles.id, { onDelete: "set null" }),
  isAvailable: boolean("is_available").notNull().default(true),
  createdAt: createdAt(),
});

export const cabRides = pgTable(
  "cab_rides",
  {
    id: id(),
    requestedById: uuid("requested_by_id").notNull(),
    requestedByName: text("requested_by_name").notNull(),
    requestedByEmail: text("requested_by_email").notNull(),
    requestedByBranch: text("requested_by_branch"),
    driverId: uuid("driver_id").references(() => cabDrivers.id, { onDelete: "set null" }),
    vehicleId: uuid("vehicle_id").references(() => cabVehicles.id, { onDelete: "set null" }),
    /** Snapshots taken when the ride is assigned, so the history still names the driver and car after either is removed. */
    driverName: text("driver_name"),
    vehiclePlate: text("vehicle_plate"),
    pickup: text("pickup").notNull(),
    dropoff: text("dropoff").notNull(),
    /** Where the pickup and drop-off are, when the person chose a suggested address (or their own location); null for typed text. */
    pickupLat: coord("pickup_lat"),
    pickupLng: coord("pickup_lng"),
    dropoffLat: coord("dropoff_lat"),
    dropoffLng: coord("dropoff_lng"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: cabRideStatus("status").notNull().default("pending"),
    notes: text("notes"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** When the driver entered the rider's OTP (which also started the ride). */
    otpVerifiedAt: timestamp("otp_verified_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledByName: text("cancelled_by_name"),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cab_rides_status_idx").on(t.status),
    index("cab_rides_scheduled_idx").on(t.scheduledFor),
    index("cab_rides_driver_idx").on(t.driverId),
    index("cab_rides_requested_by_idx").on(t.requestedById),
  ],
);

/**
 * One OTP per ride, made when it is assigned (and again when an admin asks for a new one). The rider shows it to the driver; three wrong
 * tries lock it. It expires 2 hours after the ride's scheduled time, and never sooner than 2 hours after it was made.
 */
export const cabRideOtps = pgTable("cab_ride_otps", {
  id: id(),
  rideId: uuid("ride_id").notNull().unique().references(() => cabRides.id, { onDelete: "cascade" }),
  otp: char("otp", { length: 4 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Where drivers' phones were, sent every 10 seconds while a ride is under way. Deleted after 24 hours by the daily cron. */
export const cabDriverLocations = pgTable(
  "cab_driver_locations",
  {
    id: id(),
    driverId: uuid("driver_id").notNull().references(() => cabDrivers.id, { onDelete: "cascade" }),
    latitude: coord("latitude").notNull(),
    longitude: coord("longitude").notNull(),
    accuracy: real("accuracy"),
    /** Direction of travel in degrees (0 = north). */
    heading: real("heading"),
    /** km/h. */
    speed: real("speed"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    rideId: uuid("ride_id").references(() => cabRides.id, { onDelete: "set null" }),
  },
  (t) => [
    index("cab_driver_locations_driver_idx").on(t.driverId, t.recordedAt.desc()),
    index("cab_driver_locations_ride_idx").on(t.rideId),
    index("cab_driver_locations_recorded_idx").on(t.recordedAt.desc()),
  ],
);

/** The module's own audit log (Cabs Admin → Audit Log). Names are snapshots, so an entry still reads correctly after the person is gone. */
export const cabAuditLog = pgTable(
  "cab_audit_log",
  {
    id: id(),
    action: text("action").notNull(),
    actorId: uuid("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    rideId: uuid("ride_id").references(() => cabRides.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("cab_audit_log_created_idx").on(t.createdAt.desc()), index("cab_audit_log_ride_idx").on(t.rideId)],
);

export type CabRideStatus = (typeof cabRideStatus.enumValues)[number];
