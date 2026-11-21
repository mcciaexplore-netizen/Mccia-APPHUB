import Link from "next/link";
import { Card, PageHeader } from "@/components/attendance/ui";
import { PeopleTable } from "@/components/attendance/admin/PeopleTable";
import { IpEditor } from "@/components/attendance/admin/SettingsView";
import { requireAdmin } from "@/lib/attendance/dal";
import { peopleList } from "@/lib/attendance/admin";
import { getSettings } from "@/lib/attendance/config";

export const metadata = { title: "People · Attendance Admin" };

/** Everyone with the Attendance application: shift, reporting manager, employment type and dates; and the office IPs for laptop check-in. */
export default async function AdminPeoplePage() {
  await requireAdmin();
  const [{ people, shifts }, settings] = await Promise.all([peopleList(), getSettings()]);
  return (
    <>
      <PageHeader title="People" subtitle={<>Everyone given the Attendance application. To add someone, give them the application in Administrator → Users. Shifts are set up in <Link href="/attendance/admin/settings" className="font-semibold text-[var(--att-primary)]">Settings</Link>.</>} />
      <div className="flex flex-col gap-5">
        <Card pad={false}>
          <PeopleTable people={people} shifts={shifts} />
        </Card>
        <IpEditor settings={settings} />
      </div>
    </>
  );
}
