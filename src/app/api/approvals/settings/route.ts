import { ok, readJson, route } from "@/lib/approvals/guard";
import { getSettings, saveSettings, settingsInput } from "@/lib/approvals/settings";

export const dynamic = "force-dynamic";

export const GET = route({}, async () => ok({ settings: await getSettings() }));

export const PUT = route({ roles: ["approvals_admin"] }, async ({ req, user }) => ok({ settings: await saveSettings(await readJson(req, settingsInput), user) }));
