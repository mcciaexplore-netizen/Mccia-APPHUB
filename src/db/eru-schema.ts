import { boolean, date, index, integer, jsonb, pgEnum, pgSequence, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * ERU module tables (the Economic Research Unit's projects and the documents written in its editor). Every table and type is prefixed eru_
 * and nothing here touches a hub table. People are hub users, referenced by user id WITHOUT a foreign key, as in the other modules: the hub
 * can delete users, and a project's history must outlive them. File contents live in Supabase Storage (private bucket eru-files); eru_files
 * keeps what is known about each stored object.
 *
 * A document's content is the editor's JSON (TipTap/ProseMirror). Tracked changes and comments live IN that content as marks (eru_insertion,
 * eru_deletion, eru_comment, each carrying an id); eru_document_changes and eru_document_comments hold the record of each one (who, when,
 * what, and the review), kept in step with the content on every save. The production driver has no transactions: every write stands on its
 * own, and the code orders them so a half-done step is harmless.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const projectStatusEnum = pgEnum("eru_project_status", ["draft", "active", "in_review", "completed", "archived"]);
export const priorityEnum = pgEnum("eru_priority", ["urgent", "high", "normal", "low"]);
export const changeStatusEnum = pgEnum("eru_change_status", ["pending", "accepted", "rejected"]);

/** Project numbers (ERU-0001, ERU-0002 ...): a sequence, so two projects made at the same moment can never share one. */
export const projectNumberSeq = pgSequence("eru_project_seq", { startWith: 1, increment: 1 });

/** The unit's areas of work. The five are seeded by the migration; admins edit their names, colours and order but never their key. */
export const domains = pgTable("eru_domains", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("blue"),
  icon: text("icon").notNull().default("folder"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAt(),
});

export const projects = pgTable(
  "eru_projects",
  {
    id: id(),
    number: text("number").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    domainId: uuid("domain_id")
      .notNull()
      .references(() => domains.id, { onDelete: "restrict" }),
    status: projectStatusEnum("status").notNull().default("active"),
    priority: priorityEnum("priority").notNull().default("normal"),
    createdBy: uuid("created_by").notNull(),
    assignedTo: jsonb("assigned_to").$type<string[]>().notNull().default([]),
    dueDate: date("due_date"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    referenceLinks: jsonb("reference_links").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("eru_projects_domain_idx").on(t.domainId, t.updatedAt),
    index("eru_projects_status_idx").on(t.status),
    index("eru_projects_assigned_idx").using("gin", t.assignedTo),
  ],
);

export const documents = pgTable(
  "eru_documents",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    originalFileId: uuid("original_file_id"),
    // Goes up by one on every save: a save made from an older version is refused, so two people never overwrite each other unseen.
    version: integer("version").notNull().default(1),
    // While on, every edit is tracked; anyone may switch it on, only an ERU admin off.
    trackChanges: boolean("track_changes").notNull().default(false),
    createdBy: uuid("created_by").notNull(),
    lastEditedBy: uuid("last_edited_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("eru_documents_project_idx").on(t.projectId, t.updatedAt)],
);

export const documentComments = pgTable(
  "eru_document_comments",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    content: text("content").notNull(),
    // Where the comment was made, as editor positions when it was written (the live anchor is the comment mark in the content).
    selectionFrom: integer("selection_from").notNull().default(0),
    selectionTo: integer("selection_to").notNull().default(0),
    quote: text("quote").notNull().default(""),
    resolved: boolean("resolved").notNull().default(false),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("eru_comments_document_idx").on(t.documentId, t.createdAt)],
);

export const documentChanges = pgTable(
  "eru_document_changes",
  {
    // The same id as the change's mark in the content.
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    changeType: text("change_type").notNull(), // insertion | deletion
    fromContent: text("from_content").notNull().default(""),
    toContent: text("to_content").notNull().default(""),
    selectionFrom: integer("selection_from").notNull().default(0),
    selectionTo: integer("selection_to").notNull().default(0),
    status: changeStatusEnum("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("eru_changes_document_idx").on(t.documentId, t.status), index("eru_changes_status_idx").on(t.status)],
);

export const files = pgTable(
  "eru_files",
  {
    id: id(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    // False until a project or document claims it; files never claimed are removed after a day.
    attached: boolean("attached").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("eru_files_project_idx").on(t.projectId), index("eru_files_unattached_idx").on(t.attached, t.createdAt)],
);

export const auditLogs = pgTable(
  "eru_audit_logs",
  {
    id: id(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("eru_audit_project_idx").on(t.projectId, t.createdAt), index("eru_audit_created_idx").on(t.createdAt)],
);

/** One row (id 1): general settings and when the background clean-up last ran. */
export const settings = pgTable("eru_settings", {
  id: smallint("id").primaryKey(),
  trackChangesDefault: boolean("track_changes_default").notNull().default(false),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export type Domain = typeof domains.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type Priority = (typeof priorityEnum.enumValues)[number];
export type ChangeStatus = (typeof changeStatusEnum.enumValues)[number];
