import "server-only";
import { listMembers, notify } from "./host-adapter";
import { getSettings } from "./config";
import { effectiveGoLive } from "./settings";
import { loadDays, recordOf, viewOf } from "./days";
import { istDay, istMinutes, parseHm } from "./time";

/**
 * Check-in and check-out reminders on the hub bell. Vercel Cron calls /api/cron/attendance-reminders every 15 minutes in office hours
 * (vercel.json); each run sends what is due:
 *   - after the check-in reminder time: everyone on a working day who has not checked in and is not on full-day leave (or is WFH-approved);
 *   - after the check-out reminder time: everyone checked in today and not yet out.
 * Each reminder has a per-person, per-day key, so however often the job runs, a person gets each reminder at most once a day.
 */

export async function sendReminders(now = new Date()): Promise<{ checkIn: number; checkOut: number; skipped?: string }> {
  const s = await getSettings();
  if (!s.reminders.enabled) return { checkIn: 0, checkOut: 0, skipped: "Reminders are switched off in Settings." };
  const today = istDay(now);
  if (today < effectiveGoLive(s, today)) return { checkIn: 0, checkOut: 0, skipped: "Attendance has not gone live yet (Settings → go-live date)." };
  const minute = istMinutes(now);
  const inAt = parseHm(s.reminders.checkIn) ?? 630;
  const outAt = parseHm(s.reminders.checkOut) ?? 1065;
  if (minute < inAt && minute < outAt) return { checkIn: 0, checkOut: 0 };
  const members = await listMembers();
  const data = await loadDays(
    members.map((m) => m.id),
    today,
    today,
  );
  const checkIn: { userId: string; title: string; body: string; link: string; key: string }[] = [];
  const checkOut: typeof checkIn = [];
  for (const m of members) {
    const v = viewOf(data, m.id, today, today);
    const r = recordOf(data, m.id, today);
    if (minute >= inAt && !r?.checkInTime && v.kind === "working" && v.leave?.half !== "none" && v.leave?.half !== "first") {
      checkIn.push({ userId: m.id, title: "Don't forget to check in", body: v.wfh ? "You are working from home today: check in from Attendance." : "You have not checked in yet today.", link: "/attendance", key: `remind-in:${m.id}:${today}` });
    }
    if (minute >= outAt && r?.checkInTime && !r.checkOutTime) {
      checkOut.push({ userId: m.id, title: "Don't forget to check out", body: "You are still checked in. Check out before you leave.", link: "/attendance", key: `remind-out:${m.id}:${today}` });
    }
  }
  await notify([...checkIn, ...checkOut]);
  return { checkIn: checkIn.length, checkOut: checkOut.length };
}
