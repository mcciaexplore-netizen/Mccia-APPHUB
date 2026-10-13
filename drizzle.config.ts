import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config();

export default defineConfig({
  dialect: "postgresql",
  // The Approvals module keeps its apr_ tables in their own file; both feed the same migration journal.
  schema: ["./src/db/schema.ts", "./src/db/approvals-schema.ts"],
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
