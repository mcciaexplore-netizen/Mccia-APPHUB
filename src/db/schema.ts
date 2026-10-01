import {
  bigserial,
  boolean,
  index,
  integer,
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
export const activityActionEnum = pgEnum("activity_action", ["login", "launch"]);

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

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("member"),
  homeDepartmentId: uuid("home_department_id").references(() => departments.id, {
    onDelete: "set null",
  }),
  phone: text("phone"),
  designation: text("designation"),
  passwordHash: text("password_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

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
    createdAt: createdAt(),
  },
  (t) => [index("apps_department_idx").on(t.departmentId)],
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
    userId: uuid("user_id").references(() => users.id),
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

export type Role = (typeof roleEnum.enumValues)[number];
export type User = typeof users.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type App = typeof apps.$inferSelect;
export type AccessTemplate = typeof accessTemplates.$inferSelect;
