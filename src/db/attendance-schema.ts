import { boolean, date, doublePrecision, index, integer, jsonb, numeric, pgEnum, pgTable, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Attendance module tables (check-in/out, leave, WFH, regularization, comp-off, time tracking, feeds). Every table and type is prefixed att_
 * and nothing here touches a hub table. People are hub users, referenced by user id WITHOUT a foreign key, as in the other modules: the hub
 * can delete users, and attendance history must outlive them. A person's reporting manager is the hub's own users.reporting_manager_id (read
 * and written through host-adapter.ts), never a copy here.
 *
 * Every day is in India time (IST). A day with no punch has no att_attendance row: absent, weekly off and holiday are worked out when a page
 * is read (calendar.ts), so no nightly job is needed. The production driver has no transactions: each write stands on its own, and unique
 * indexes keep the rules true when two requests race (one check-in per person per day, one balance row per person, type and year).
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const days = (name: string) => numeric(name, { precision: 6, scale: 2, mode: "number" });

export const checkInMethodEnum = pgEnum("att_check_in_method", ["gps", "ip", "manual", "wfh"]);
/** Where a punch was made: within the office radius or on the office network = in_office; anywhere else = remote. */
export const punchPlaceEnum = pgEnum("att_punch_place", ["in_office", "remote"]);
export const dayStatusEnum = pgEnum("att_day_status", ["present", "absent", "half_day", "holiday", "weekly_off", "leave", "wfh"]);
export const employmentTypeEnum = pgEnum("att_employment_type", ["intern", "consultant", "staff"]);
export const halfDayEnum = pgEnum("att_half_day", ["none", "first", "second"]);
export const requestStatusEnum = pgEnum("att_request_status", ["pending", "approved", "rejected", "cancelled"]);
export const compoffStatusEnum = pgEnum("att_compoff_status", ["pending", "approved", "rejected", "used", "expired", "cancelled"]);
export const compoffTypeEnum = pgEnum("att_compoff_type", ["full", "half"]);
export const timesheetStatusEnum = pgEnum("att_timesheet_status", ["draft", "submitted", "approved", "rejected"]);
export const missedPunchEnum = pgEnum("att_missed_punch", ["checkin", "checkout", "both"]);
export const accrualTypeEnum = pgEnum("att_accrual_type", ["full_year", "monthly"]);

export type CheckInMethod = (typeof checkInMethodEnum.enumValues)[number];
export type DayStatus = (typeof dayStatusEnum.enumValues)[number];
export type EmploymentType = (typeof employmentTypeEnum.enumValues)[number];
export type HalfDay = (typeof halfDayEnum.enumValues)[number];
export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
export type CompoffStatus = (typeof compoffStatusEnum.enumValues)[number];
export type TimesheetStatus = (typeof timesheetStatusEnum.enumValues)[number];
export type MissedPunch = (typeof missedPunchEnum.enumValues)[number];
export type AccrualType = (typeof accrualTypeEnum.enumValues)[number];

/** Working hours. "General" (10:00-17:30) is seeded and is the default for anyone without one. */
export const shifts = pgTable("att_shifts", {
  id: id(),
  name: text("name").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  graceMinutes: integer("grace_minutes").notNull().default(45),
  fullDayHours: days("full_day_hours").notNull().default(7.5),
  halfDayHours: days("half_day_hours").notNull().default(4),
  firstHalfEnd: time("first_half_end").notNull().default("14:00"),
  secondHalfStart: time("second_half_start").notNull().default("14:00"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

/** What Attendance knows about a person beyond the hub: shift, employment type, joining date and birthday. One row per person, made on first need. */
export const userProfiles = pgTable("att_user_profiles", {
  id: id(),
  userId: uuid("user_id").notNull().unique(),
  shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
  employmentType: employmentTypeEnum("employment_type").notNull().default("staff"),
  dateOfJoining: date("date_of_joining"),
  dateOfBirth: date("date_of_birth"),
  updatedAt: updatedAt(),
});

export const holidays = pgTable(
  "att_holidays",
  {
    id: id(),
    date: date("date").notNull(),
    name: text("name").notNull(),
    isOptional: boolean("is_optional").notNull().default(false),
    year: integer("year").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("att_holidays_date_uq").on(t.date), index("att_holidays_year_idx").on(t.year)],
);

/** One row per person per day they punched (or were regularized). The unique index is what makes a second check-in impossible. */
export const attendance = pgTable(
  "att_attendance",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    shiftId: uuid("shift_id"),
    checkInTime: timestamp("check_in_time", { withTimezone: true }),
    checkOutTime: timestamp("check_out_time", { withTimezone: true }),
    checkInMethod: checkInMethodEnum("check_in_method"),
    checkOutMethod: checkInMethodEnum("check_out_method"),
    checkInLat: doublePrecision("check_in_lat"),
    checkInLng: doublePrecision("check_in_lng"),
    checkInIp: text("check_in_ip"),
    checkInAccuracyM: doublePrecision("check_in_accuracy_m"),
    checkInPlace: punchPlaceEnum("check_in_place"),
    checkInDistanceM: integer("check_in_distance_m"),
    checkInArea: text("check_in_area"),
    checkOutLat: doublePrecision("check_out_lat"),
    checkOutLng: doublePrecision("check_out_lng"),
    checkOutIp: text("check_out_ip"),
    checkOutAccuracyM: doublePrecision("check_out_accuracy_m"),
    checkOutPlace: punchPlaceEnum("check_out_place"),
    checkOutDistanceM: integer("check_out_distance_m"),
    checkOutArea: text("check_out_area"),
    isLate: boolean("is_late").notNull().default(false),
    isEarlyOut: boolean("is_early_out").notNull().default(false),
    isWfh: boolean("is_wfh").notNull().default(false),
    isExtraWork: boolean("is_extra_work").notNull().default(false),
    hoursWorked: days("hours_worked"),
    deficitHours: days("deficit_hours"),
    excessHours: days("excess_hours"),
    regularizationId: uuid("regularization_id"),
    status: dayStatusEnum("status").notNull().default("present"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("att_attendance_user_date_uq").on(t.userId, t.date), index("att_attendance_date_idx").on(t.date)],
);

export const leaveTypes = pgTable("att_leave_types", {
  id: id(),
  name: text("name").notNull(),
  color: text("color").notNull().default("blue"),
  daysPerYear: days("days_per_year").notNull().default(21),
  accrualType: accrualTypeEnum("accrual_type").notNull().default("full_year"),
  carryForwardCap: days("carry_forward_cap").notNull().default(0),
  maxConsecutiveDays: integer("max_consecutive_days"),
  noticePeriodDays: integer("notice_period_days").notNull().default(0),
  allowHalfDay: boolean("allow_half_day").notNull().default(false),
  halfDayFirst: boolean("half_day_first").notNull().default(true),
  halfDaySecond: boolean("half_day_second").notNull().default(true),
  requiresDocumentAfterDays: integer("requires_document_after_days"),
  requiresReason: boolean("requires_reason").notNull().default(false),
  availableTo: text("available_to").notNull().default("all"),
  countWeekends: boolean("count_weekends").notNull().default(false),
  // Comp-off has no yearly entitlement: its balance is the person's approved, unexpired comp-offs (compoff.ts).
  isCompoff: boolean("is_compoff").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
});

/**
 * A person's year for one leave type. `entitled` is the year's full entitlement (prorated for a joiner) and `carried` what came over from last
 * year; `adjusted` is the sum of HR's adjustments. `booked` (approved) and `pending` are recomputed from the requests in one statement after
 * every change, so they cannot drift. The balance itself is worked out (leave-rules.ts), never stored.
 */
export const leaveBalances = pgTable(
  "att_leave_balances",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    entitled: days("entitled").notNull().default(0),
    carried: days("carried").notNull().default(0),
    adjusted: days("adjusted").notNull().default(0),
    booked: days("booked").notNull().default(0),
    pending: days("pending").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("att_leave_balances_uq").on(t.userId, t.leaveTypeId, t.year)],
);

/** Who asked, for what, and the decision. `approver_id` is who it was sent to (the manager; null = HR); `decided_by` who actually decided. */
export const leaveRequests = pgTable(
  "att_leave_requests",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    halfDay: halfDayEnum("half_day").notNull().default("none"),
    daysCount: days("days_count").notNull(),
    reason: text("reason").notNull().default(""),
    // The stored document's key in the attendance-files bucket (never a public link).
    attachmentUrl: text("attachment_url"),
    attachmentName: text("attachment_name"),
    status: requestStatusEnum("status").notNull().default("pending"),
    approverId: uuid("approver_id"),
    decidedBy: uuid("decided_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approverRemark: text("approver_remark"),
    ccUserIds: jsonb("cc_user_ids").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("att_leave_requests_user_idx").on(t.userId, t.startDate), index("att_leave_requests_status_idx").on(t.status, t.approverId), index("att_leave_requests_dates_idx").on(t.startDate, t.endDate)],
);

export const wfhRequests = pgTable(
  "att_wfh_requests",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    reason: text("reason").notNull(),
    planNote: text("plan_note").notNull().default(""),
    status: requestStatusEnum("status").notNull().default("pending"),
    approverId: uuid("approver_id"),
    decidedBy: uuid("decided_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approverRemark: text("approver_remark"),
    createdAt: createdAt(),
  },
  (t) => [
    // One live WFH request per person per day.
    uniqueIndex("att_wfh_live_uq").on(t.userId, t.date).where(sql`status in ('pending', 'approved')`),
    index("att_wfh_status_idx").on(t.status, t.approverId),
    index("att_wfh_date_idx").on(t.date),
  ],
);

/**
 * Leaving before the shift's hours are worked. Check-out is refused until the full hours are in (checkin-rules.ts checkoutGate); an approved
 * request for today lifts that. One live request per person per day. Added in migration 0045.
 */
export const earlyDepartures = pgTable(
  "att_early_departures",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    reason: text("reason").notNull(),
    status: requestStatusEnum("status").notNull().default("pending"),
    approverId: uuid("approver_id"),
    decidedBy: uuid("decided_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approverRemark: text("approver_remark"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("att_early_live_uq").on(t.userId, t.date).where(sql`status in ('pending', 'approved')`),
    index("att_early_status_idx").on(t.status, t.approverId),
  ],
);

export const regularizationRequests = pgTable(
  "att_regularization_requests",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    date: date("date").notNull(),
    missed: missedPunchEnum("missed").notNull(),
    requestedCheckin: time("requested_checkin"),
    requestedCheckout: time("requested_checkout"),
    reason: text("reason").notNull(),
    status: requestStatusEnum("status").notNull().default("pending"),
    approverId: uuid("approver_id"),
    decidedBy: uuid("decided_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approverRemark: text("approver_remark"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("att_regularization_live_uq").on(t.userId, t.date).where(sql`status in ('pending', 'approved')`),
    index("att_regularization_status_idx").on(t.status, t.approverId),
  ],
);

/** A comp-off earned by working a holiday or weekly off. `used` and `expired` are worked out when read (compoff.ts, oldest first). */
export const compoffRequests = pgTable(
  "att_compoff_requests",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    workedDate: date("worked_date").notNull(),
    compoffType: compoffTypeEnum("compoff_type").notNull().default("full"),
    reason: text("reason").notNull().default(""),
    expiryDate: date("expiry_date"),
    status: compoffStatusEnum("status").notNull().default("pending"),
    approverId: uuid("approver_id"),
    decidedBy: uuid("decided_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approverRemark: text("approver_remark"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("att_compoff_live_uq").on(t.userId, t.workedDate).where(sql`status in ('pending', 'approved', 'used')`),
    index("att_compoff_status_idx").on(t.status, t.approverId),
  ],
);

export const timeProjects = pgTable("att_time_projects", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const timeLogs = pgTable(
  "att_time_logs",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => timeProjects.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    hours: days("hours").notNull(),
    description: text("description").notNull().default(""),
    weekStartDate: date("week_start_date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("att_time_logs_user_week_idx").on(t.userId, t.weekStartDate), index("att_time_logs_project_idx").on(t.projectId, t.date)],
);

export const timesheets = pgTable(
  "att_timesheets",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    weekStartDate: date("week_start_date").notNull(),
    status: timesheetStatusEnum("status").notNull().default("draft"),
    totalHours: days("total_hours").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approverId: uuid("approver_id"),
    decidedBy: uuid("decided_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approverRemark: text("approver_remark"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("att_timesheets_user_week_uq").on(t.userId, t.weekStartDate), index("att_timesheets_status_idx").on(t.status, t.approverId)],
);

export const announcements = pgTable("att_announcements", {
  id: id(),
  createdBy: uuid("created_by").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  createdAt: createdAt(),
});

/** Attendance's settings: one row, key "config", whose value settings.ts reads with defaults for anything missing. */
export const settings = pgTable("att_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

/** Each add or deduct HR makes to a balance, with its remark: the Leave Tracker's history. att_leave_balances.adjusted is their sum. */
export const leaveAdjustments = pgTable(
  "att_leave_adjustments",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    days: days("days").notNull(),
    remark: text("remark").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("att_leave_adjustments_user_idx").on(t.userId, t.year)],
);

/** Wishes sent on the Home feed. The unique index is "once per person per event". Events themselves are worked out from profiles. */
export const wishes = pgTable(
  "att_wishes",
  {
    id: id(),
    fromUserId: uuid("from_user_id").notNull(),
    toUserId: uuid("to_user_id").notNull(),
    eventType: text("event_type").notNull(),
    eventDate: date("event_date").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("att_wishes_once_uq").on(t.fromUserId, t.toUserId, t.eventType, t.eventDate), index("att_wishes_to_idx").on(t.toUserId, t.eventDate)],
);

/**
 * Phones and browsers that asked for Attendance notifications (Web Push). One row per browser (its push endpoint); a person can have several.
 * Pushes carry no message: the service worker fetches the latest notice itself (/api/attendance/push/latest), so nothing here is a secret
 * beyond the endpoint. Added in migration 0046.
 */
export const pushSubscriptions = pgTable(
  "att_push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull().default(""),
    auth: text("auth").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("att_push_endpoint_uq").on(t.endpoint), index("att_push_user_idx").on(t.userId)],
);

export type Shift = typeof shifts.$inferSelect;
export type UserProfile = typeof userProfiles.$inferSelect;
export type Holiday = typeof holidays.$inferSelect;
export type AttendanceRow = typeof attendance.$inferSelect;
export type LeaveType = typeof leaveTypes.$inferSelect;
export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type WfhRequest = typeof wfhRequests.$inferSelect;
export type EarlyDeparture = typeof earlyDepartures.$inferSelect;
export type RegularizationRequest = typeof regularizationRequests.$inferSelect;
export type CompoffRequest = typeof compoffRequests.$inferSelect;
export type TimeProject = typeof timeProjects.$inferSelect;
export type TimeLog = typeof timeLogs.$inferSelect;
export type Timesheet = typeof timesheets.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
