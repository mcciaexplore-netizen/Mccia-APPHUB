import { bigint, boolean, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Inventory module tables. Every table and type is prefixed inventory_ and nothing here touches a hub table.
 * People are referenced by user id WITHOUT a foreign key: the hub can delete users, and stock history must outlive them. Each row that
 * names a person also keeps a snapshot of their name. Money is integer paise. Quantities are whole units.
 *
 * Issues, returns, inward goods, adjustments and recounts are all rows in one ledger (inventory_stock_movements), so an item's quantity
 * can always be explained. inventory_items.quantity is kept in step with it by single atomic statements (the production driver has no
 * transactions): change the quantity only with a conditional UPDATE that cannot go below zero, and write the movement in the same statement.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const paise = (name: string) => bigint(name, { mode: "number" });

export const inventoryMovementKind = pgEnum("inventory_movement_kind", ["inward", "issue", "return", "adjust", "recount"]);
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
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inventory_items_name_uq").on(sql`lower(${t.name})`),
    index("inventory_items_category_idx").on(t.categoryId),
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
    actorUserId: uuid("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_movements_item_idx").on(t.itemId, t.createdAt),
    index("inventory_movements_kind_idx").on(t.kind, t.createdAt),
    index("inventory_movements_issue_idx").on(t.issueId),
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
  },
  (t) => [
    index("inventory_requests_status_idx").on(t.status, t.requestedAt),
    index("inventory_requests_requester_idx").on(t.requestedByUserId, t.requestedAt),
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

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InventoryRequest = typeof inventoryRequests.$inferSelect;
