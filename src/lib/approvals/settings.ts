import "server-only";
import { z } from "zod";
import { db } from "@/db";
import { aprSettings } from "@/db/approvals-schema";
import { recordAudit } from "./audit";
import type { ApprovalsUser } from "./host-adapter";

/** Defaults, used until an admin saves a value. The threshold's starting value can also come from APPROVALS_THRESHOLD_PAISE. */
const DEFAULT_THRESHOLD_PAISE = 1_000_000; // 10,000 rupees

export type ApprovalsSettings = {
  /** Expenditure of this amount or more is "above 10k" and needs the DG. */
  thresholdPaise: number;
  reminderAfterHours: number;
  largeFormShowQuotation: boolean;
  notifyApproverOnAssignment: boolean;
  notifyRequesterOnOutcome: boolean;
  notifyAdminOnImportErrors: boolean;
};

const KEYS = {
  thresholdPaise: "threshold_paise",
  reminderAfterHours: "reminder_after_hours",
  largeFormShowQuotation: "large_form_show_quotation",
  notifyApproverOnAssignment: "notify_approver_on_assignment",
  notifyRequesterOnOutcome: "notify_requester_on_outcome",
  notifyAdminOnImportErrors: "notify_admin_on_import_errors",
} as const satisfies Record<keyof ApprovalsSettings, string>;

function envThreshold(): number {
  const n = Number(process.env.APPROVALS_THRESHOLD_PAISE);
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_THRESHOLD_PAISE;
}

const asInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && Number.isSafeInteger(n) && n > 0 ? n : fallback;
};
const asBool = (v: string | undefined, fallback: boolean) => (v === undefined ? fallback : v === "true");

export async function getSettings(): Promise<ApprovalsSettings> {
  const rows = await db.select().from(aprSettings);
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    thresholdPaise: asInt(m.get(KEYS.thresholdPaise), envThreshold()),
    reminderAfterHours: asInt(m.get(KEYS.reminderAfterHours), 48),
    largeFormShowQuotation: asBool(m.get(KEYS.largeFormShowQuotation), true),
    notifyApproverOnAssignment: asBool(m.get(KEYS.notifyApproverOnAssignment), true),
    notifyRequesterOnOutcome: asBool(m.get(KEYS.notifyRequesterOnOutcome), true),
    notifyAdminOnImportErrors: asBool(m.get(KEYS.notifyAdminOnImportErrors), true),
  };
}

export const settingsInput = z.object({
  thresholdPaise: z.number().int().min(100, "The threshold must be at least 1 rupee").max(1_000_000_000_000),
  reminderAfterHours: z.number().int().min(1, "At least 1 hour").max(720, "At most 720 hours"),
  largeFormShowQuotation: z.boolean(),
  notifyApproverOnAssignment: z.boolean(),
  notifyRequesterOnOutcome: z.boolean(),
  notifyAdminOnImportErrors: z.boolean(),
});

export async function saveSettings(input: ApprovalsSettings, actor: ApprovalsUser): Promise<ApprovalsSettings> {
  const before = await getSettings();
  const keys = Object.keys(KEYS) as (keyof ApprovalsSettings)[];
  for (const k of keys) {
    if (before[k] === input[k]) continue; // only write what changed
    await db
      .insert(aprSettings)
      .values({ key: KEYS[k], value: String(input[k]) })
      .onConflictDoUpdate({ target: aprSettings.key, set: { value: String(input[k]), updatedAt: new Date() } });
  }
  const changed = keys.filter((k) => before[k] !== input[k]);
  if (changed.length) await recordAudit(actor, "setting", null, "update", `Changed settings: ${changed.join(", ")}`, before, input);
  return input;
}
