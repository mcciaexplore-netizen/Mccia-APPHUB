import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Approvals module tables. Every table is prefixed apr_ and nothing here touches a host table.
 * People are referenced by user id WITHOUT a foreign key: the host can delete users, and requests and audit rows must outlive them.
 * Each row that names a person also keeps a snapshot of their name (and email where it matters).
 * Money is integer paise.
 */

// The type list is meant to grow (reimbursement, events, car booking): add a value here, a detail table and routing rules.
export const aprRequestType = pgEnum("apr_request_type", ["hr", "expenditure_small", "expenditure_large"]);
// "returned": an approver sent the request back to the person who raised it, to be corrected and resubmitted to the same approver.
export const aprRequestStatus = pgEnum("apr_request_status", ["draft", "pending", "approved", "rejected", "withdrawn", "returned"]);
export const aprStepStatus = pgEnum("apr_step_status", ["waiting", "pending", "approved", "rejected", "skipped", "returned"]);
export const aprAttachmentSlot = pgEnum("apr_attachment_slot", ["file_upload", "file_upload_2", "tax_invoice", "quotation", "supporting"]);
export const aprEventAction = pgEnum("apr_event_action", [
  "submitted", "assigned", "approved", "rejected", "withdrawn", "resubmitted", "reassigned", "comment", "viewed", "returned",
]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => bigint(name, { mode: "number" });

/* ----------------------------------------------------------------- masters */

export const aprCategories = pgTable(
  "apr_categories",
  {
    id: id(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    // Old spellings from Zoho, so imported records land on the right category.
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    // Likely duplicates share a group name and show a Merge action in the admin screen.
    duplicateGroup: text("duplicate_group"),
    // Set when this category was merged into another one; it is then inactive.
    mergedIntoId: uuid("merged_into_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("apr_categories_name_uq").on(sql`lower(${t.name})`)],
);

export const aprHrCategories = pgTable(
  "apr_hr_categories",
  {
    id: id(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("apr_hr_categories_name_uq").on(sql`lower(${t.name})`)],
);

export const aprBranches = pgTable(
  "apr_branches",
  {
    id: id(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("apr_branches_name_uq").on(sql`lower(${t.name})`)],
);

export const aprPublicationTypes = pgTable(
  "apr_publication_types",
  {
    id: id(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("apr_publication_types_name_uq").on(sql`lower(${t.name})`)],
);

export const aprPublications = pgTable(
  "apr_publications",
  {
    id: id(),
    publicationTypeId: uuid("publication_type_id")
      .notNull()
      .references(() => aprPublicationTypes.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("apr_publications_name_uq").on(t.publicationTypeId, sql`lower(${t.name})`)],
);

/** Budget per financial year ("2026-27"), branch and category. */
export const aprBudgets = pgTable(
  "apr_budgets",
  {
    id: id(),
    financialYear: text("financial_year").notNull(),
    branchId: uuid("branch_id").notNull().references(() => aprBranches.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").notNull().references(() => aprCategories.id, { onDelete: "restrict" }),
    allocatedPaise: paise("allocated_paise").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("apr_budgets_fy_branch_category_uq").on(t.financialYear, t.branchId, t.categoryId)],
);

/** One row per step. min/max amount bands are optional (null max = no upper bound) and let a future type route by amount. */
export const aprApproverRules = pgTable(
  "apr_approver_rules",
  {
    id: id(),
    requestType: aprRequestType("request_type").notNull(),
    stepNo: integer("step_no").notNull(),
    stepLabel: text("step_label").notNull(),
    minAmountPaise: paise("min_amount_paise").notNull().default(0),
    maxAmountPaise: paise("max_amount_paise"),
    approverUserIds: uuid("approver_user_ids").array().notNull().default(sql`'{}'::uuid[]`),
    active: boolean("active").notNull().default(true),
  },
  (t) => [unique("apr_approver_rules_type_step_min_uq").on(t.requestType, t.stepNo, t.minAmountPaise)],
);

export const aprSettings = pgTable("apr_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Module roles that cannot be derived from the host: viewer and approvals_admin. (approver and dg come from the routing rules.) */
export const aprUserRoles = pgTable(
  "apr_user_roles",
  {
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
    grantedById: uuid("granted_by_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

/** Serial numbers: one row per prefix and financial year, for example "EXP-2026-27". Bumped with a single atomic statement. */
export const aprCounters = pgTable("apr_counters", {
  key: text("key").primaryKey(),
  lastValue: integer("last_value").notNull().default(0),
});

/* ---------------------------------------------------------------- requests */

export const aprRequests = pgTable(
  "apr_requests",
  {
    id: id(),
    // Set at submit, so drafts have none. Serial per prefix per financial year, for example EXP-2026-27-0001.
    requestNo: text("request_no").unique(),
    type: aprRequestType("type").notNull(),
    status: aprRequestStatus("status").notNull().default("draft"),
    requesterUserId: uuid("requester_user_id").notNull(),
    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    financialYear: text("financial_year"),
    currentStep: integer("current_step").notNull().default(0),
    totalSteps: integer("total_steps").notNull().default(0),
    currentApproverUserId: uuid("current_approver_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionComment: text("decision_comment"),
    amountPaise: paise("amount_paise"),
    // Expenditure only: the amount was more than the budget left, or no budget exists for the branch, category and year.
    overBudget: boolean("over_budget").notNull().default(false),
    // Resubmit clones a rejected request into a new draft and links back to the original.
    resubmittedFromId: uuid("resubmitted_from_id"),
    // Reserved for a later import of old Zoho records.
    legacyId: text("legacy_id").unique(),
    reminderLastSentAt: timestamp("reminder_last_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("apr_requests_status_idx").on(t.status),
    index("apr_requests_type_idx").on(t.type),
    index("apr_requests_requester_idx").on(t.requesterUserId),
    index("apr_requests_approver_idx").on(t.currentApproverUserId),
    index("apr_requests_requested_at_idx").on(t.requestedAt),
    index("apr_requests_fy_idx").on(t.financialYear),
  ],
);

export const aprExpenditureDetails = pgTable("apr_expenditure_details", {
  requestId: uuid("request_id").primaryKey().references(() => aprRequests.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => aprCategories.id, { onDelete: "restrict" }),
  natureOfExpenditure: text("nature_of_expenditure"),
  branchId: uuid("branch_id").notNull().references(() => aprBranches.id, { onDelete: "restrict" }),
  // Snapshots taken on the server at submit time.
  budgetAllocatedPaise: paise("budget_allocated_paise"),
  budgetAvailablePaise: paise("budget_available_paise"),
  budgetRemainingPaise: paise("budget_remaining_paise"),
  differencePaise: paise("difference_paise"),
  // Required on the small form, optional on the large one, so the form decides.
  vendorName: text("vendor_name"),
  taxInvoiceDate: date("tax_invoice_date"),
  expenseDate: date("expense_date"),
  publicationTypeId: uuid("publication_type_id").references(() => aprPublicationTypes.id, { onDelete: "restrict" }),
  publicationId: uuid("publication_id").references(() => aprPublications.id, { onDelete: "restrict" }),
});

export const aprHrDetails = pgTable("apr_hr_details", {
  requestId: uuid("request_id").primaryKey().references(() => aprRequests.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  hrCategoryId: uuid("hr_category_id").notNull().references(() => aprHrCategories.id, { onDelete: "restrict" }),
  description: text("description"),
  // Only when the request carries an amount: the budget it is spent from (branch and expense category), and what the budget looked like
  // when it was submitted. Such a request counts against that budget like an expenditure does.
  branchId: uuid("branch_id").references(() => aprBranches.id, { onDelete: "restrict" }),
  budgetCategoryId: uuid("budget_category_id").references(() => aprCategories.id, { onDelete: "restrict" }),
  budgetAllocatedPaise: paise("budget_allocated_paise"),
  budgetAvailablePaise: paise("budget_available_paise"),
  budgetRemainingPaise: paise("budget_remaining_paise"),
});

export const aprAttachments = pgTable(
  "apr_attachments",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => aprRequests.id, { onDelete: "cascade" }),
    slot: aprAttachmentSlot("slot").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("apr_attachments_request_idx").on(t.requestId)],
);

/**
 * Uploaded files live in Postgres, in chunks small enough for one request each (the host caps a request body at about 4.5 MB, the
 * module allows 10 MB per file). A file is "attached" once a submitted request points at it; unattached ones are leftovers that a
 * cleanup can drop. The bytes are only ever served through an authorised route, so a file is private by construction.
 */
export const aprFiles = pgTable(
  "apr_files",
  {
    id: id(),
    uploadedBy: uuid("uploaded_by").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    attached: boolean("attached").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("apr_files_uploader_idx").on(t.uploadedBy, t.createdAt)],
);

/** A bytea column. Never read or written as a bare value: use decode(..., 'base64') to write and encode(..., 'base64') to read, so both drivers see text. */
const bytea = customType<{ data: string; driverData: string }>({ dataType: () => "bytea" });

/** One slice of a file, 3 MB at most. */
export const aprFileChunks = pgTable(
  "apr_file_chunks",
  {
    fileId: uuid("file_id").notNull().references(() => aprFiles.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    data: bytea("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.idx] })],
);

/** Created at submit from the routing rules, so later rule changes never alter requests already in flight. */
export const aprRequestSteps = pgTable(
  "apr_request_steps",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => aprRequests.id, { onDelete: "cascade" }),
    stepNo: integer("step_no").notNull(),
    stepLabel: text("step_label").notNull(),
    approverUserId: uuid("approver_user_id").notNull(),
    approverName: text("approver_name").notNull(),
    status: aprStepStatus("status").notNull().default("waiting"),
    comment: text("comment"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [unique("apr_request_steps_request_step_uq").on(t.requestId, t.stepNo), index("apr_request_steps_approver_idx").on(t.approverUserId, t.status)],
);

/** Append only. Nothing in the code updates or deletes these rows, and the database refuses to delete a request that has any. */
export const aprApprovalEvents = pgTable(
  "apr_approval_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    requestId: uuid("request_id").notNull().references(() => aprRequests.id, { onDelete: "restrict" }),
    action: aprEventAction("action").notNull(),
    stepNo: integer("step_no"),
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name").notNull(),
    fromStatus: aprRequestStatus("from_status"),
    toStatus: aprRequestStatus("to_status"),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [index("apr_approval_events_request_idx").on(t.requestId, t.createdAt)],
);

/* ------------------------------------------------------ notifications, audit */

/** The bell: one row per person per thing that happened. */
export const aprNotifications = pgTable(
  "apr_notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    requestId: uuid("request_id").references(() => aprRequests.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("apr_notifications_user_idx").on(t.userId, t.createdAt)],
);

/** Every admin change to masters, routing rules, roles and settings. Request history lives in apr_approval_events instead. */
export const aprAdminAudit = pgTable(
  "apr_admin_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [index("apr_admin_audit_created_idx").on(t.createdAt)],
);

/** Hits on rate-limited routes (submit, upload). A table, not memory, because serverless instances do not share memory. */
export const aprRateLimits = pgTable(
  "apr_rate_limits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bucket: text("bucket").notNull(),
    userId: uuid("user_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("apr_rate_limits_idx").on(t.bucket, t.userId, t.createdAt)],
);

export type AprRequestType = (typeof aprRequestType.enumValues)[number];
export type AprRequestStatus = (typeof aprRequestStatus.enumValues)[number];
