import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Cab Booking module tables. Every table and type is prefixed cab_ and nothing here touches a hub table.
 * People are referenced by user id WITHOUT a foreign key, the same as Inventory and Approvals: the hub can delete users, and ride history
 * must outlive them. Each row that names a person keeps a snapshot of their name (and, where mail goes to them, their email). Drivers are
 * not tied to a hub account at all: they are a name, an email and a phone number (see cabDrivers).
 *
 * A ride's status only ever moves forward, by single conditional statements (the production driver has no transactions):
 *   pending → assigned → in_progress → completed, and pending or assigned → cancelled.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

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
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: cabRideStatus("status").notNull().default("pending"),
    notes: text("notes"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
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
