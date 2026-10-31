import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  // The Approvals, Inventory and Cab Booking modules keep their apr_, inventory_ and cab_ tables in their own files; all feed the same migration journal.
  schema: ["./src/db/schema.ts", "./src/db/approvals-schema.ts", "./src/db/inventory-schema.ts", "./src/db/cabs-schema.ts", "./src/db/ivr-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
