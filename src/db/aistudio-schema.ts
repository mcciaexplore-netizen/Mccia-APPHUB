import { boolean, date, index, integer, jsonb, pgEnum, pgSequence, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * AI Studio module tables (requests from staff to the AI Studio team: apps, automations, chatbots, data work, websites). Every table and
 * type is prefixed aistudio_ and nothing here touches a hub table. People are hub users, referenced by user id WITHOUT a foreign key, as in
 * the other modules: the hub can delete users, and a request's history must outlive them. File contents live in Supabase Storage (private
 * bucket aistudio-files); aistudio_files keeps what is known about each stored object.
 *
 * A request moves pending_review → accepted → in_progress → review_testing → delivered → closed, or pending_review → declined. The
 * production driver has no transactions: every write stands on its own, and the code orders them so a half-done step is harmless.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const requestTypeEnum = pgEnum("aistudio_request_type", ["app_development", "automation", "chatbot", "data_analysis", "website_tool", "other"]);
export const statusEnum = pgEnum("aistudio_status", ["pending_review", "accepted", "in_progress", "review_testing", "delivered", "closed", "declined"]);
export const priorityEnum = pgEnum("aistudio_priority", ["urgent", "high", "normal", "low"]);
export const filePurposeEnum = pgEnum("aistudio_file_purpose", ["attachment", "deliverable"]);

/** Request numbers (AS-0001, AS-0002 ...): a sequence, so two requests made at the same moment can never share one. */
export const requestNumberSeq = pgSequence("aistudio_request_seq", { startWith: 1, increment: 1 });

export const requests = pgTable(
  "aistudio_requests",
  {
    id: id(),
    number: text("number").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    requestType: requestTypeEnum("request_type").notNull(),
    department: text("department"),
    status: statusEnum("status").notNull().default("pending_review"),
    // Set by the AI Studio team, never by the requester.
    priority: priorityEnum("priority"),
    deadline: date("deadline"),
    requesterId: uuid("requester_id").notNull(),
    assigneeId: uuid("assignee_id"),
    referenceLinks: jsonb("reference_links").$type<string[]>().notNull().default([]),
    content: text("content"),
    declineReason: text("decline_reason"),
    deliveryNotes: text("delivery_notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("aistudio_requests_status_idx").on(t.status, t.createdAt),
    index("aistudio_requests_requester_idx").on(t.requesterId, t.createdAt),
    index("aistudio_requests_assignee_idx").on(t.assigneeId),
  ],
);

export const files = pgTable(
  "aistudio_files",
  {
    id: id(),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    purpose: filePurposeEnum("purpose").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    // False until a request claims it; files never claimed are removed after a day.
    attached: boolean("attached").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("aistudio_files_unattached_idx").on(t.attached, t.createdAt)],
);

/** A file on a request: the requester's attachments and the team's deliverables (told apart by the file's purpose). */
export const attachments = pgTable(
  "aistudio_attachments",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("aistudio_attachments_request_idx").on(t.requestId)],
);

export const notes = pgTable(
  "aistudio_notes",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    body: text("body").notNull(),
    // Internal notes are for the AI Studio team only; the others are shown to the requester.
    isInternal: boolean("is_internal").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("aistudio_notes_request_idx").on(t.requestId, t.createdAt)],
);

export const auditLogs = pgTable(
  "aistudio_audit_logs",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("aistudio_audit_request_idx").on(t.requestId, t.createdAt), index("aistudio_audit_created_idx").on(t.createdAt)],
);

/** One row (id 1): the optional Slack webhook and when the background jobs last ran. */
export const settings = pgTable("aistudio_settings", {
  id: smallint("id").primaryKey(),
  slackWebhook: text("slack_webhook"),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export type Request = typeof requests.$inferSelect;
export type RequestType = (typeof requestTypeEnum.enumValues)[number];
export type RequestStatus = (typeof statusEnum.enumValues)[number];
export type Priority = (typeof priorityEnum.enumValues)[number];
export type FilePurpose = (typeof filePurposeEnum.enumValues)[number];
