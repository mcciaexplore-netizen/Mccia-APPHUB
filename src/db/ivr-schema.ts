import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * IVR-CRM module tables (the Membership team's calling CRM, connected to Tata Smartflo and Zoho Mail). Every table and type is prefixed
 * ivr_ and nothing here touches a hub table. People are hub users, referenced by user id WITHOUT a foreign key, the same as Cab Booking,
 * Inventory and Approvals: the hub can delete users, and call history must outlive them. The few things IVR-CRM keeps about a person (the
 * phone or softphone extension Smartflo rings, their Smartflo agent) live in ivr_agent_profiles.
 *
 * A member's stage follows the calls: new → attempted → connected, and an agent can close (and reopen) a member. Every call, whether it
 * came from a Smartflo webhook, the scheduled sync or the Call button, is written through one function keyed on the Smartflo call id
 * (src/lib/ivr/smartflo/ingest.ts), so repeats are harmless. The production driver has no transactions: every write stands on its own.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const stageEnum = pgEnum("ivr_stage", ["new", "attempted", "connected", "closed"]);
export const providerEnum = pgEnum("ivr_provider", ["smartflo_org", "smartflo_c2c", "zoho"]);
export const callStatusEnum = pgEnum("ivr_call_status", ["answered", "missed", "ongoing", "unknown"]);
export const outcomeEnum = pgEnum("ivr_call_outcome", ["answered", "not_answered", "busy", "switched_off", "invalid", "failed"]);
export const appliesToEnum = pgEnum("ivr_category_applies_to", ["inbound", "outbound", "both"]);

/** What IVR-CRM keeps about a hub user who calls: where Smartflo rings them first, and their Smartflo agent. One row per person, made on first use. */
export const agentProfiles = pgTable("ivr_agent_profiles", {
  userId: uuid("user_id").primaryKey(),
  phone: text("phone"),
  // Smartflo softphone extension (060...). When set, the Call button rings this browser softphone instead of the phone above.
  softphoneExtension: text("softphone_extension"),
  // Smartflo agent this person is mapped to (ivr_smartflo_agents.id)
  smartfloAgentId: text("smartflo_agent_id"),
  updatedAt: updatedAt(),
});

// userId null = organisation-wide connection
export const integrations = pgTable(
  "ivr_integrations",
  {
    id: id(),
    userId: uuid("user_id"),
    provider: providerEnum("provider").notNull(),
    encryptedSecret: text("encrypted_secret"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("connected"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ivr_integrations_user_idx").on(t.userId, t.provider)],
);

export const smartfloAgents = pgTable("ivr_smartflo_agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  number: text("number"),
  extension: text("extension"),
  email: text("email"),
  mappedUserId: uuid("mapped_user_id"),
  updatedAt: updatedAt(),
});

// What a call is about (membership, proforma, hall booking ...). Edited by IVR admins.
export const callCategories = pgTable(
  "ivr_call_categories",
  {
    id: id(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    appliesTo: appliesToEnum("applies_to").notNull().default("both"),
    // Inbound only: the IVR menu key that maps to this category
    ivrKey: text("ivr_key"),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ivr_call_categories_key_uq").on(t.key)],
);

export const importBatches = pgTable("ivr_import_batches", {
  id: id(),
  fileName: text("file_name").notNull(),
  uploadedBy: uuid("uploaded_by"),
  totalRows: integer("total_rows").notNull().default(0),
  matched: integer("matched").notNull().default(0),
  ambiguous: integer("ambiguous").notNull().default(0),
  unmatched: integer("unmatched").notNull().default(0),
  duplicates: integer("duplicates").notNull().default(0),
  status: text("status").notNull().default("saved"),
  columnMap: jsonb("column_map").$type<Record<string, string>>().notNull().default({}),
  createdAt: createdAt(),
});

/** The members the team calls. owner_id is the agent (hub user) they are allocated to; agents only ever see their own. */
export const leads = pgTable(
  "ivr_leads",
  {
    id: id(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    company: text("company"),
    query: text("query"),
    source: text("source"),
    stage: stageEnum("stage").notNull().default("new"),
    ownerId: uuid("owner_id"),
    // Membership number or code from the import file
    memberCode: text("member_code"),
    // Purpose of the outreach for this member (from the import), copied onto calls placed from the CRM
    categoryId: uuid("category_id").references(() => callCategories.id, { onDelete: "set null" }),
    attempts: integer("attempts").notNull().default(0),
    lastOutcome: outcomeEnum("last_outcome"),
    lastCallAt: timestamp("last_call_at", { withTimezone: true }),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    extra: jsonb("extra").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ivr_leads_phone_uq").on(t.phone),
    index("ivr_leads_owner_stage_idx").on(t.ownerId, t.stage),
    index("ivr_leads_queue_idx").on(t.ownerId, t.stage, t.lastCallAt),
  ],
);

export const leadAssignments = pgTable(
  "ivr_lead_assignments",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id"),
    toUserId: uuid("to_user_id"),
    byUserId: uuid("by_user_id"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("ivr_lead_assignments_lead_idx").on(t.leadId)],
);

export const leadStageEvents = pgTable(
  "ivr_lead_stage_events",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    fromStage: stageEnum("from_stage"),
    toStage: stageEnum("to_stage").notNull(),
    byUserId: uuid("by_user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("ivr_lead_stage_events_lead_idx").on(t.leadId)],
);

/** Every Membership call. agent_user_id is the agent (hub user) who handled it; agents only ever see their own. */
export const calls = pgTable(
  "ivr_calls",
  {
    id: id(),
    smartfloCallId: text("smartflo_call_id").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    agentUserId: uuid("agent_user_id"),
    smartfloAgentId: text("smartflo_agent_id"),
    agentName: text("agent_name"),
    agentNumber: text("agent_number"),
    direction: text("direction").notNull().default("inbound"),
    status: callStatusEnum("status").notNull().default("unknown"),
    outcome: outcomeEnum("outcome"),
    categoryId: uuid("category_id").references(() => callCategories.id, { onDelete: "set null" }),
    // ivr = chosen by the caller's menu key, lead = campaign category of the member, agent = set by the agent after the call
    categorySource: text("category_source"),
    remark: text("remark"),
    customerNumber: text("customer_number").notNull(),
    didNumber: text("did_number"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSec: integer("duration_sec").notNull().default(0),
    answeredSec: integer("answered_sec").notNull().default(0),
    recordingUrl: text("recording_url"),
    dtmf: text("dtmf"),
    disposition: text("disposition"),
    hangupCause: text("hangup_cause"),
    refId: text("ref_id"),
    callFlow: jsonb("call_flow").$type<unknown[]>(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    source: text("source").notNull().default("sync"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("ivr_calls_smartflo_call_id_uq").on(t.smartfloCallId),
    index("ivr_calls_agent_started_idx").on(t.agentUserId, t.startedAt),
    index("ivr_calls_lead_idx").on(t.leadId),
    index("ivr_calls_customer_idx").on(t.customerNumber),
    index("ivr_calls_ref_idx").on(t.refId),
    index("ivr_calls_started_idx").on(t.startedAt),
    index("ivr_calls_category_idx").on(t.categoryId),
  ],
);

/** Every Smartflo webhook payload, stored untouched before it is processed. */
export const callEvents = pgTable(
  "ivr_call_events",
  {
    id: id(),
    trigger: text("trigger"),
    callId: text("call_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("ivr_call_events_call_idx").on(t.callId)],
);

// One row per press of the Call button, so the call Smartflo reports later can be tied back to the lead and category.
export const dialRequests = pgTable(
  "ivr_dial_requests",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    categoryId: uuid("category_id").references(() => callCategories.id, { onDelete: "set null" }),
    refId: text("ref_id"),
    status: text("status").notNull().default("pending"), // pending | matched | failed
    error: text("error"),
    resolvedCallId: uuid("resolved_call_id").references(() => calls.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ivr_dial_requests_ref_idx").on(t.refId), index("ivr_dial_requests_lead_idx").on(t.leadId, t.requestedAt)],
);

// Used by the importer for rows that name no agent: members of a category go to these agents.
export const allocationRules = pgTable(
  "ivr_allocation_rules",
  {
    id: id(),
    categoryId: uuid("category_id").notNull().references(() => callCategories.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    weight: integer("weight").notNull().default(1),
  },
  (t) => [uniqueIndex("ivr_allocation_rules_uq").on(t.categoryId, t.userId)],
);

/** Module settings by key: retry (the retry rule), membership_lines (the Membership DIDs), autosync (the automatic sync hours). */
export const appSettings = pgTable("ivr_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export const notes = pgTable(
  "ivr_notes",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ivr_notes_lead_idx").on(t.leadId)],
);

export const emails = pgTable(
  "ivr_emails",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    zohoMessageId: text("zoho_message_id"),
    status: text("status").notNull().default("sent"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ivr_emails_lead_idx").on(t.leadId)],
);

export const auditLog = pgTable(
  "ivr_audit",
  {
    id: id(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    target: text("target"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("ivr_audit_created_idx").on(t.createdAt)],
);

export type Lead = typeof leads.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type CallCategory = typeof callCategories.$inferSelect;
export type Outcome = (typeof outcomeEnum.enumValues)[number];
export type Stage = (typeof stageEnum.enumValues)[number];
/** The role a person acts with inside IVR-CRM (see src/lib/ivr/ivr.manifest.ts): ivr_agent, ivr_admin, ivr_super_admin. */
export type Role = "agent" | "admin" | "super_admin";
