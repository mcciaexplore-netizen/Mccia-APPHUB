import { bigint, boolean, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { branches } from "./schema";

/**
 * Inventory module tables. Every table and type is prefixed inventory_ and nothing here touches a hub table.
 * People are referenced by user id WITHOUT a foreign key: the hub can delete users, and stock history must outlive them. Each row that
 * names a person also keeps a snapshot of their name. Money is integer paise. Quantities are whole units.
 *
 * Issues, returns, inward goods, adjustments and recounts are all rows in one ledger (inventory_stock_movements), so an item's quantity
 * can always be explained. inventory_items.quantity is kept in step with it by single atomic statements (the production driver has no
 * transactions): change the quantity only with a conditional UPDATE that cannot go below zero, and write the movement in the same statement.
 *
 * Stock is kept per branch (the hub's branches): the catalogue (inventory_items) is shared, and inventory_branch_stock holds how many of each
 * item each branch has, and its own low-stock level. inventory_items.quantity is the total across branches, kept in step in the same
 * statements (it is what the code before branches read, so an Instant Rollback still shows the right totals). Every movement and request
 * names its branch; a transfer moves stock from one branch to another (inventory_transfers, with a movement at each end).
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => bigint(name, { mode: "number" });

export const inventoryMovementKind = pgEnum("inventory_movement_kind", ["inward", "issue", "return", "adjust", "recount", "transfer"]);
export const inventoryRequestStatus = pgEnum("inventory_request_status", ["pending", "approved", "fulfilled", "rejected", "cancelled"]);
export const inventoryPoStatus = pgEnum("inventory_po_status", ["draft", "sent", "received", "cancelled"]);
export const inventoryTicketStatus = pgEnum("inventory_ticket_status", ["open", "in_progress", "resolved"]);

/** Module roles: inventory_admin (everything, including settings) and inventory_staff (stock, requests, purchases). Everyone signed in to the hub may raise requests. */
export const inventoryUserRoles = pgTable(
  "inventory_user_roles",
  {
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(),
    grantedById: uuid("granted_by_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const inventoryCategories = pgTable(
  "inventory_categories",
  {
    id: id(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inventory_categories_name_uq").on(sql`lower(${t.name})`)],
);

export const inventoryVendors = pgTable(
  "inventory_vendors",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    gstin: text("gstin"),
    pan: text("pan"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inventory_vendors_name_uq").on(sql`lower(${t.name})`)],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: id(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => inventoryCategories.id, { onDelete: "set null" }),
    unit: text("unit").notNull().default("Nos"),
    quantity: integer("quantity").notNull().default(0),
    minQuantity: integer("min_quantity").notNull().default(0),
    ratePaise: paise("rate_paise"),
    location: text("location"),
    defaultVendorId: uuid("default_vendor_id").references(() => inventoryVendors.id, { onDelete: "set null" }),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    /** The branch it was first added at. Its stock at each branch is in inventory_branch_stock. */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inventory_items_name_uq").on(sql`lower(${t.name})`),
    index("inventory_items_category_idx").on(t.categoryId),
  ],
);

/**
 * How many of an item one branch has. A row appears when the branch first gets the item. This is the table as it is in production (it
 * existed before migration 0025, whose CREATE TABLE IF NOT EXISTS left it as it was; migration 0026 brings other databases to the same
 * shape). low_stock_level is not used yet: an item's low-stock level is its own min_quantity, the same at every branch.
 */
export const inventoryBranchStock = pgTable(
  "inventory_branch_stock",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(0),
    lowStockLevel: integer("low_stock_level").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("inventory_branch_stock_item_id_branch_id_unique").on(t.itemId, t.branchId),
    index("inventory_branch_stock_branch_idx").on(t.branchId),
  ],
);

/**
 * Every change to an item's quantity. delta is signed (issue negative, return and inward positive); a recount stores the difference it made.
 * An issue names who or what received it (a person, a department, or an event); its returns point back at it through issueId.
 */
export const inventoryStockMovements = pgTable(
  "inventory_stock_movements",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
    kind: inventoryMovementKind("kind").notNull(),
    delta: integer("delta").notNull(),
    quantityAfter: integer("quantity_after").notNull(),
    reason: text("reason"),
    // issue / return
    issuedToUserId: uuid("issued_to_user_id"),
    issuedToName: text("issued_to_name"),
    issuedToDepartmentId: uuid("issued_to_department_id"),
    eventName: text("event_name"),
    issueId: uuid("issue_id"),
    consumed: boolean("consumed").notNull().default(false),
    // inward goods
    vendorId: uuid("vendor_id").references(() => inventoryVendors.id, { onDelete: "set null" }),
    purchaseOrderId: uuid("purchase_order_id"),
    challanNo: text("challan_no"),
    ratePaise: paise("rate_paise"),
    // where it came from
    requestId: uuid("request_id"),
    /** Where it happened. A transfer has a movement at each branch. */
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_movements_item_idx").on(t.itemId, t.createdAt),
    index("inventory_movements_branch_idx").on(t.branchId, t.createdAt),
    index("inventory_movements_kind_idx").on(t.kind, t.createdAt),
    index("inventory_movements_issue_idx").on(t.issueId),
    // The Vendors page asks, for each vendor, whether any movement names it (and deleting a vendor clears them): without this, a full scan each.
    index("inventory_movements_vendor_idx").on(t.vendorId),
  ],
);

/** Requisitions: one item each, like the standalone app. Approving and fulfilling it writes an issue movement (fulfilledMovementId). */
export const inventoryRequests = pgTable(
  "inventory_requests",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    note: text("note"),
    status: inventoryRequestStatus("status").notNull().default("pending"),
    requestedByUserId: uuid("requested_by_user_id").notNull(),
    requestedByName: text("requested_by_name").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedByUserId: uuid("resolved_by_user_id"),
    resolvedByName: text("resolved_by_name"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    fulfilledMovementId: uuid("fulfilled_movement_id"),
    /** The requester's branch when they asked: the stock it is fulfilled from. */
    branchId: uuid("branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
  },
  (t) => [
    index("inventory_requests_status_idx").on(t.status, t.requestedAt),
    index("inventory_requests_requester_idx").on(t.requestedByUserId, t.requestedAt),
    index("inventory_requests_branch_idx").on(t.branchId, t.status),
  ],
);

/** Stock moved from one branch to another by an Inventory admin. The two movements it made are "transfer" rows at each branch. */
export const inventoryTransfers = pgTable(
  "inventory_transfers",
  {
    id: id(),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "restrict" }),
    fromBranchId: uuid("from_branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    toBranchId: uuid("to_branch_id").notNull().references(() => branches.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    reason: text("reason"),
    actorId: uuid("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_transfers_created_idx").on(t.createdAt),
    index("inventory_transfers_item_idx").on(t.itemId),
    check("inventory_transfers_quantity_check", sql`${t.quantity} > 0`),
  ],
);

export const inventoryPurchaseOrders = pgTable(
  "inventory_purchase_orders",
  {
    id: id(),
    poNo: text("po_no").unique(),
    vendorId: uuid("vendor_id").references(() => inventoryVendors.id, { onDelete: "set null" }),
    vendorName: text("vendor_name").notNull(),
    vendorEmail: text("vendor_email"),
    notes: text("notes"),
    status: inventoryPoStatus("status").notNull().default("draft"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (t) => [index("inventory_pos_status_idx").on(t.status, t.createdAt)],
);

export const inventoryPurchaseOrderLines = pgTable(
  "inventory_purchase_order_lines",
  {
    id: id(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => inventoryPurchaseOrders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => inventoryItems.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    ratePaise: paise("rate_paise").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("inventory_po_lines_po_idx").on(t.purchaseOrderId)],
);

/** Maintenance complaints and how they were resolved. Photos are links (where they are stored is decided when uploads are built). */
export const inventoryMaintenanceTickets = pgTable(
  "inventory_maintenance_tickets",
  {
    id: id(),
    title: text("title").notNull(),
    note: text("note"),
    location: text("location"),
    photoUrl: text("photo_url"),
    status: inventoryTicketStatus("status").notNull().default("open"),
    raisedByUserId: uuid("raised_by_user_id").notNull(),
    raisedByName: text("raised_by_name").notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedByUserId: uuid("resolved_by_user_id"),
    resolvedByName: text("resolved_by_name"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    resolutionPhotoUrl: text("resolution_photo_url"),
  },
  (t) => [index("inventory_tickets_status_idx").on(t.status, t.raisedAt)],
);

/**
 * The Inventory module's own audit log (Inventory → Audit Log, for Inventory admins): who did what to which item, request or ticket, and
 * at which branch. Separate from the hub's audit log, which keeps its own inventory.* entries as before. Names are snapshots, so an entry
 * still reads correctly after the person or item is gone.
 */
export const invAuditLog = pgTable(
  "inv_audit_log",
  {
    id: id(),
    action: text("action").notNull(),
    actorId: uuid("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    targetLabel: text("target_label").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("inv_audit_log_created_idx").on(t.createdAt.desc()),
    index("inv_audit_log_actor_idx").on(t.actorId),
    index("inv_audit_log_branch_idx").on(t.branchId),
  ],
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InventoryRequest = typeof inventoryRequests.$inferSelect;
