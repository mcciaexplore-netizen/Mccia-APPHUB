import { boolean, date, index, integer, jsonb, pgEnum, pgTable, real, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * DesignDesk module tables (the design team's request and workflow system, rebuilt from the DesignDesk app). Every table and type is
 * prefixed design_ and nothing here touches a hub table. People are hub users, referenced by user id WITHOUT a foreign key, as in Cab
 * Booking, Inventory and IVR-CRM: the hub can delete users, and a ticket's history must outlive them. File contents live in Supabase
 * Storage (private bucket design-files); design_files keeps what is known about each stored object.
 *
 * A ticket moves pending_review → new → assigned → in_progress (↔ waiting_on_requester) → in_review → delivered → closed. Asking for
 * changes on a design closes that version as superseded and opens the next one (DF-0001 → DF-0001-V2). The production driver has no
 * transactions: every write stands on its own, and the code orders them so a half-done step is harmless.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const ticketStatusEnum = pgEnum("design_ticket_status", [
  "pending_review",
  "new",
  "assigned",
  "in_progress",
  "waiting_on_requester",
  "in_review",
  "delivered",
  "closed",
  "closed_without_approval",
  "superseded",
  "declined",
]);
export const priorityEnum = pgEnum("design_priority", ["low", "normal", "high", "urgent"]);
export const approvalStatusEnum = pgEnum("design_approval_status", ["pending", "approved", "changes_requested", "revoked", "expired"]);
export const cdrStatusEnum = pgEnum("design_cdr_status", ["requested", "approved", "declined", "uploaded"]);
export const holidayTypeEnum = pgEnum("design_holiday_type", ["national", "company", "optional"]);
export const postStatusEnum = pgEnum("design_post_status", ["planned", "posted"]);
export const filePurposeEnum = pgEnum("design_file_purpose", ["attachment", "proof", "cdr", "library", "post_image"]);

/** A kind of design (Flyer, Instagram post ...): the questions the request form asks for it, its turnaround and its typical effort. */
export const designTypes = pgTable("design_types", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  slaHours: integer("sla_hours").notNull().default(48),
  effortHours: real("effort_hours").notNull().default(4),
  // Overrides design_settings.edit_window_hours for this type.
  editWindowHours: integer("edit_window_hours"),
  // [{ id, label, type: text|select|number, options, required }]
  questions: jsonb("questions").$type<DesignQuestion[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const tickets = pgTable(
  "design_tickets",
  {
    id: id(),
    number: text("number").notNull().unique(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    // The first design asked for: it decides the turnaround and who is suggested. Every design asked for is in `requirements`.
    designTypeId: uuid("design_type_id").notNull(),
    requirements: jsonb("requirements").$type<string[]>().notNull().default([]),
    // Answers to each design's questions: { [type key]: { [question id]: answer } }.
    details: jsonb("details").$type<Record<string, Record<string, string | number>>>().notNull().default({}),
    eventName: text("event_name"),
    eventDate: date("event_date"),
    deliveryDate: date("delivery_date"),
    department: text("department"),
    referenceLinks: jsonb("reference_links").$type<string[]>().notNull().default([]),
    // Changes the client asked for outside the app, written down by the team: [{ text, at, by }].
    clientChanges: jsonb("client_changes").$type<{ text: string; at: string; by: string }[]>().notNull().default([]),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    priority: priorityEnum("priority").notNull().default("normal"),
    status: ticketStatusEnum("status").notNull().default("pending_review"),
    requesterId: uuid("requester_id").notNull(),
    assigneeId: uuid("assignee_id"),
    figmaUrl: text("figma_url"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    // While waiting on the requester the deadline clock is paused.
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedSeconds: integer("paused_seconds").notNull().default(0),
    isOverdue: boolean("is_overdue").notNull().default(false),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    editWindowEndsAt: timestamp("edit_window_ends_at", { withTimezone: true }),
    isLocked: boolean("is_locked").notNull().default(false),
    parentId: uuid("parent_id"),
    versionNumber: integer("version_number").notNull().default(1),
    reasonForChange: text("reason_for_change"),
    declineReason: text("decline_reason"),
    estimateHours: real("estimate_hours"),
    timeSpentSeconds: integer("time_spent_seconds").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("design_tickets_status_idx").on(t.status),
    index("design_tickets_assignee_idx").on(t.assigneeId),
    index("design_tickets_requester_idx").on(t.requesterId),
    index("design_tickets_parent_idx").on(t.parentId),
    index("design_tickets_due_idx").on(t.dueAt),
  ],
);

export const subtasks = pgTable(
  "design_subtasks",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("design_subtasks_ticket_idx").on(t.ticketId)],
);

/** An object in the design-files bucket. `attached` is set once something (a ticket, proof, library version ...) points at it. */
export const files = pgTable(
  "design_files",
  {
    id: id(),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    purpose: filePurposeEnum("purpose").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    attached: boolean("attached").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("design_files_unattached_idx").on(t.attached, t.createdAt)],
);

export const attachments = pgTable(
  "design_attachments",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    fileId: uuid("file_id").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("design_attachments_ticket_idx").on(t.ticketId)],
);

export const auditLogs = pgTable(
  "design_audit_logs",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    // Null for the requester reviewing by link and for the scheduled jobs; actor_label then says who it was.
    userId: uuid("user_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("design_audit_ticket_idx").on(t.ticketId, t.createdAt), index("design_audit_created_idx").on(t.createdAt)],
);

export const proofVersions = pgTable(
  "design_proof_versions",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    version: integer("version").notNull(),
    fileId: uuid("file_id").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("design_proof_ticket_version_uq").on(t.ticketId, t.version)],
);

/** A review link sent to the requester. Only the sha256 of the link's token is stored. */
export const approvalRequests = pgTable(
  "design_approval_requests",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    proofVersionId: uuid("proof_version_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    recipientEmail: text("recipient_email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByName: text("decided_by_name"),
    decisionComment: text("decision_comment"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("design_approval_ticket_idx").on(t.ticketId, t.status)],
);

/** A numbered comment pinned on a spot of a proof image (positions are percentages of the image). */
export const pinpoints = pgTable(
  "design_pinpoints",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    proofVersionId: uuid("proof_version_id").notNull(),
    authorId: uuid("author_id").notNull(),
    xPct: real("x_pct").notNull(),
    yPct: real("y_pct").notNull(),
    content: text("content").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("design_pinpoints_ticket_idx").on(t.ticketId)],
);

/** Source-file (CDR/PSD/AI) requests: the requester asks, a lead approves, a designer uploads, the requester downloads. */
export const cdrRequests = pgTable(
  "design_cdr_requests",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    status: cdrStatusEnum("status").notNull().default("requested"),
    requesterId: uuid("requester_id").notNull(),
    approverId: uuid("approver_id"),
    fileId: uuid("file_id"),
    uploadedBy: uuid("uploaded_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("design_cdr_ticket_idx").on(t.ticketId)],
);

export const cdrDownloads = pgTable("design_cdr_downloads", {
  id: id(),
  cdrRequestId: uuid("cdr_request_id").notNull(),
  userId: uuid("user_id").notNull(),
  downloadedAt: timestamp("downloaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const folders = pgTable("design_folders", {
  id: id(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

export const libraryItems = pgTable(
  "design_library_items",
  {
    id: id(),
    folderId: uuid("folder_id").notNull(),
    name: text("name").notNull(),
    ticketId: uuid("ticket_id"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    isApprovedFinal: boolean("is_approved_final").notNull().default(false),
    expiryDate: date("expiry_date"),
    usageRightsNote: text("usage_rights_note"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("design_library_items_folder_idx").on(t.folderId)],
);

export const libraryVersions = pgTable(
  "design_library_versions",
  {
    id: id(),
    itemId: uuid("item_id").notNull(),
    version: integer("version").notNull(),
    fileId: uuid("file_id").notNull(),
    note: text("note"),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("design_library_item_version_uq").on(t.itemId, t.version)],
);

export const timeEntries = pgTable(
  "design_time_entries",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull(),
    userId: uuid("user_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    // Null while the timer is running.
    endedAt: timestamp("ended_at", { withTimezone: true }),
    seconds: integer("seconds").notNull().default(0),
    note: text("note"),
    source: text("source").notNull().default("timer"), // timer | manual
  },
  (t) => [index("design_time_ticket_idx").on(t.ticketId), index("design_time_user_idx").on(t.userId, t.startedAt)],
);

export const holidays = pgTable("design_holidays", {
  id: id(),
  date: date("date").notNull().unique(),
  name: text("name").notNull(),
  type: holidayTypeEnum("type").notNull().default("national"),
});

/** The studio's working hours per weekday (0 = Monday), in IST. */
export const workingSchedule = pgTable("design_working_schedule", {
  dayOfWeek: smallint("day_of_week").primaryKey(),
  isWorking: boolean("is_working").notNull().default(true),
  startHour: smallint("start_hour").notNull().default(10),
  endHour: smallint("end_hour").notNull().default(19),
});

export const leaves = pgTable(
  "design_leaves",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("design_leaves_user_idx").on(t.userId)],
);

/** What DesignDesk keeps about a team member: hours a day they can design, and whether they want emails. Made on first use. */
export const profiles = pgTable("design_profiles", {
  userId: uuid("user_id").primaryKey(),
  dailyCapacityHours: real("daily_capacity_hours").notNull().default(8),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  updatedAt: updatedAt(),
});

/** One row (id 1). */
export const settings = pgTable("design_settings", {
  id: smallint("id").primaryKey(),
  editWindowHours: integer("edit_window_hours").notNull().default(48),
  maxFreeRevisions: integer("max_free_revisions").notNull().default(2),
  // Ticket numbers never go below this, so numbers are never reused after "Delete all past data".
  ticketNumberFloor: integer("ticket_number_floor").notNull().default(0),
  slackWebhook: text("slack_webhook"),
  slackEvents: jsonb("slack_events").$type<Record<string, boolean>>().notNull().default({}),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const savedViews = pgTable(
  "design_saved_views",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<Record<string, string>>().notNull().default({}),
    isShared: boolean("is_shared").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("design_saved_views_user_idx").on(t.userId)],
);

export const campaigns = pgTable("design_campaigns", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#003F8A"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: createdAt(),
});

export const socialPosts = pgTable(
  "design_social_posts",
  {
    id: id(),
    campaignId: uuid("campaign_id"),
    platform: text("platform").notNull(),
    title: text("title").notNull(),
    postUrl: text("post_url"),
    postDate: date("post_date").notNull(),
    status: postStatusEnum("status").notNull().default("posted"),
    notes: text("notes"),
    imageFileId: uuid("image_file_id"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("design_social_posts_campaign_idx").on(t.campaignId), index("design_social_posts_date_idx").on(t.postDate)],
);

export type DesignQuestion = { id: string; label: string; type: "text" | "select" | "number"; options?: string[]; required?: boolean };
export type Ticket = typeof tickets.$inferSelect;
export type DesignType = typeof designTypes.$inferSelect;
export type TicketStatus = (typeof ticketStatusEnum.enumValues)[number];
export type Priority = (typeof priorityEnum.enumValues)[number];
export type ApprovalStatus = (typeof approvalStatusEnum.enumValues)[number];
export type CdrStatus = (typeof cdrStatusEnum.enumValues)[number];
export type FilePurpose = (typeof filePurposeEnum.enumValues)[number];
