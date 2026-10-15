import {
  type AnyPgColumn,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// "member" is the plain User role; "dept_lead" is reserved for a future Department Admin (no UI yet).
export const roleEnum = pgEnum("role", ["head_admin", "dept_lead", "member"]);
// Only "approved" users may sign in. An admin moves people between pending, approved and rejected.
export const userStatusEnum = pgEnum("user_status", ["pending", "approved", "rejected"]);
export const activityActionEnum = pgEnum("activity_action", ["login", "launch"]);
// What an administrator has set an application to. "active" is the original behaviour; "unavailable" cannot be launched (except by the head admin).
export const appStatusEnum = pgEnum("app_status", ["active", "testing", "unavailable"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const departments = pgTable("departments", {
  id: id(),
  name: text("name").notNull().unique(),
  slug: text("slug").unique(),
  icon: text("icon").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** An office location. People belong to at most one; separate from the hub's departments (which group applications). */
export const branches = pgTable("branches", {
  id: id(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

/** A group of people under a manager, optionally tied to a branch. */
export const teams = pgTable(
  "teams",
  {
    id: id(),
    name: text("name").notNull().unique(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("teams_branch_idx").on(t.branchId)],
);

export const users = pgTable(
  "users",
  {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("member"),
  homeDepartmentId: uuid("home_department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  // The person this one reports to. Cleared (not deleted) if that person is removed.
  reportingManagerId: uuid("reporting_manager_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  phone: text("phone"),
  designation: text("designation"),
  passwordHash: text("password_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  // Existing, admin-created and CSV-imported users are approved.
  status: userStatusEnum("status").notNull().default("approved"),
  signupSource: text("signup_source"), // csv | admin
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedById: uuid("reviewed_by_id"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  },
  (t) => [
    index("users_branch_idx").on(t.branchId),
    index("users_team_idx").on(t.teamId),
    index("users_manager_idx").on(t.reportingManagerId),
    index("users_department_idx").on(t.homeDepartmentId),
  ],
);

export const apps = pgTable(
  "apps",
  {
    id: id(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    url: text("url").notNull(),
    // Reserved for a future single sign-on handoff (signed JWT passed to the child app).
    appToken: text("app_token"),
    icon: text("icon").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    status: appStatusEnum("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [index("apps_department_idx").on(t.departmentId)],
);

/** The result of one reachability check of an application's address. Kept as history; the newest row is what the inventory shows. */
export const appChecks = pgTable(
  "app_checks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    appId: uuid("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    checkedById: uuid("checked_by_id").references(() => users.id, { onDelete: "set null" }),
    ok: boolean("ok").notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    // Plain-language outcome, for example "Reachable (HTTP 200)" or "Could not connect". Never a secret or a full URL.
    detail: text("detail").notNull(),
  },
  (t) => [index("app_checks_app_idx").on(t.appId, t.checkedAt)],
);

/**
 * A one-time link that lets a person choose their own password. Only a hash of the token is stored, so nobody (including a database
 * reader) can rebuild the link. Used for new accounts and for resets.
 */
export const userInvites = pgTable(
  "user_invites",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    // pending (not sent yet) | sent | failed | manual (no mail set up; the administrator passed the link on)
    delivery: text("delivery").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("user_invites_user_idx").on(t.userId)],
);

/**
 * Who changed what, for access, people and applications. Names are copied in so the record still reads correctly after a person or
 * application is deleted. Never holds a password, a token or a link.
 */
export const accessAudit = pgTable(
  "access_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    // For example access.change, user.create, user.update, user.deactivate, user.delete, user.invite, import.run, app.status, branch.create
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    targetLabel: text("target_label").notNull().default(""),
    details: jsonb("details").notNull().default({}),
  },
  (t) => [index("access_audit_at_idx").on(t.at), index("access_audit_target_idx").on(t.targetId), index("access_audit_actor_idx").on(t.actorId)],
);

export const userDepartmentAccess = pgTable(
  "user_department_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] })],
);

/** Which apps a user may open. Head admins implicitly see every app and need no rows. */
export const userAppAccess = pgTable(
  "user_app_access",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    grantedById: uuid("granted_by_id").references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("user_app_access_user_app_uq").on(t.userId, t.appId), index("user_app_access_app_idx").on(t.appId)],
);

export const accessTemplates = pgTable("access_templates", {
  id: id(),
  name: text("name").notNull().unique(),
  createdAt: createdAt(),
});

export const accessTemplateApps = pgTable(
  "access_template_apps",
  {
    templateId: uuid("template_id")
      .notNull()
      .references(() => accessTemplates.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.appId] })],
);

/** Every password attempt, used for rate limiting and account lockout. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    email: text("email").notNull(),
    ipAddress: text("ip_address"),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt), index("login_attempts_ip_idx").on(t.ipAddress, t.createdAt)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Set to null when the person is deleted; the row stays so the activity history is not lost.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Set to null when the app is deleted; the row (and its department) stays for history.
    appId: uuid("app_id").references(() => apps.id, { onDelete: "set null" }),
    // Null for login rows, which belong to no department.
    departmentId: uuid("department_id"),
    action: activityActionEnum("action").notNull().default("launch"),
    ipAddress: text("ip_address"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("activity_opened_at_idx").on(t.openedAt),
    index("activity_user_idx").on(t.userId),
    index("activity_app_idx").on(t.appId),
  ],
);

export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type Role = (typeof roleEnum.enumValues)[number];
export type AppStatus = (typeof appStatusEnum.enumValues)[number];
export type Branch = typeof branches.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type User = typeof users.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type App = typeof apps.$inferSelect;
export type AccessTemplate = typeof accessTemplates.$inferSelect;
