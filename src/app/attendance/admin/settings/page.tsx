import { PageHeader } from "@/components/attendance/ui";
import { SettingsView } from "@/components/attendance/admin/SettingsView";
import { requireAdmin } from "@/lib/attendance/dal";
import { getSettings, listShifts } from "@/lib/attendance/config";
import { holidaysOfYear, listLeaveTypes } from "@/lib/attendance/leave";
import { appsSetUp } from "@/lib/attendance/host-adapter";
import { istDay } from "@/lib/attendance/time";

export const metadata = { title: "Settings · Attendance Admin" };

export default async function AdminSettingsPage({ searchParams }: PageProps<"/attendance/admin/settings">) {
  await requireAdmin();
  const sp = await searchParams;
  const thisYear = Number(istDay().slice(0, 4));
  const y = Number(sp.year);
  const year = Number.isInteger(y) && Math.abs(y - thisYear) <= 5 ? y : thisYear;
  const [settings, shifts, types, hols, setup] = await Promise.all([getSettings(), listShifts(), listLeaveTypes(false), holidaysOfYear(year), appsSetUp()]);
  return (
    <>
      <PageHeader title="Settings" subtitle="Shifts, leave types, holidays, the office location and network, and the rules." />
      <SettingsView settings={settings} shifts={shifts} leaveTypes={types} holidays={hols} year={year} setup={setup} />
    </>
  );
}
