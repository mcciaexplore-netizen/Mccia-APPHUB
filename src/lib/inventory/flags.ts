/**
 * Inventory is OFF unless INVENTORY_ENABLED=true. Off, every /inventory page and /api/inventory route answers 404 and the hub shows no
 * Inventory card, so this code can be deployed before its tables exist (scripts/apply-0021-inventory-in-neon-console.sql) and switched
 * on once they do.
 */
export const inventoryEnabled = () => process.env.INVENTORY_ENABLED === "true";
