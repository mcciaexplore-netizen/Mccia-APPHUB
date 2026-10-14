import path from "node:path";
import { fileURLToPath } from "node:url";

// Settings come from the environment, and from approvals-app/.env when that file exists (see .env.example).
try { process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env")); } catch { /* no .env file: use the defaults */ }

// Imported after the environment is read, because the database and upload settings are read when those modules load.
const { createApp } = await import("./app.js");

const port = Number(process.env.PORT) || 3001;
createApp().listen(port, () => console.log(`MCCIA Approvals running on http://localhost:${port}`));
