import { PageHeader } from "@/components/attendance/ui";
import { TimeTrackerView } from "@/components/attendance/admin/TimeTrackerView";
import { requireAdmin } from "@/lib/attendance/dal";
import { allTimesheets } from "@/lib/attendance/admin";
import { allProjects } from "@/lib/attendance/timesheets";

export const metadata = { title: "Time Tracker · Attendance Admin" };

export default async function AdminTimePage({ searchParams }: PageProps<"/attendance/admin/time">) {
  await requireAdmin();
  const sp = await searchParams;
  const status = typeof sp.status === "string" && ["submitted", "approved", "rejected"].includes(sp.status) ? sp.status : "all";
  const [sheets, projects] = await Promise.all([allTimesheets(status === "all" ? null : status), allProjects()]);
  return (
    <>
      <PageHeader title="Time Tracker" subtitle="Submitted timesheets (approve, or reject with a remark) and the projects time is logged against." />
      <TimeTrackerView sheets={sheets} projects={projects.map((p) => ({ id: p.id, name: p.name, description: p.description, isActive: p.isActive }))} status={status} />
    </>
  );
}
