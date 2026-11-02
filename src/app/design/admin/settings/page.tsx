import Link from "next/link";
import { GeneralPanel, HolidaysPanel, IntegrationsPanel, SchedulePanel, TeamPanel, TypesPanel } from "@/components/design/admin/settings/panels";
import { PageHeader } from "@/components/design/ui";
import { getSchedule, getSettings, listTypes } from "@/lib/design/config";
import { requireLead } from "@/lib/design/dal";
import { listHolidays, listTeam } from "@/lib/design/admin";
import { SLACK_EVENTS } from "@/lib/design/notify";
import { storageConfigured } from "@/lib/design/storage";

const TABS = [
  { key: "types", label: "Design types" },
  { key: "schedule", label: "Working schedule" },
  { key: "holidays", label: "Holidays" },
  { key: "team", label: "Team" },
  { key: "general", label: "General" },
  { key: "integrations", label: "Integrations", superOnly: true },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** The studio's set-up, for design leads; Integrations (email, Slack, storage, deleting everything) only for the Support Admin. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const u = await requireLead();
  const tabs = TABS.filter((t) => !("superOnly" in t) || u.superAdmin);
  const asked = (await searchParams).tab;
  const tab: Tab = tabs.some((t) => t.key === asked) ? (asked as Tab) : "types";

  let body: React.ReactNode = null;
  if (tab === "types") {
    const types = await listTypes(true);
    body = <TypesPanel types={types.map((t) => ({ id: t.id, name: t.name, slaHours: t.slaHours, effortHours: t.effortHours, editWindowHours: t.editWindowHours, isActive: t.isActive, questions: t.questions.length }))} />;
  } else if (tab === "schedule") {
    const s = await getSchedule();
    body = <SchedulePanel days={[0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, ...s[d] }))} />;
  } else if (tab === "holidays") {
    body = <HolidaysPanel holidays={await listHolidays()} />;
  } else if (tab === "team") {
    body = <TeamPanel team={await listTeam()} />;
  } else if (tab === "general") {
    const s = await getSettings();
    body = <GeneralPanel settings={{ editWindowHours: s.editWindowHours, maxFreeRevisions: s.maxFreeRevisions, ticketNumberFloor: s.ticketNumberFloor }} />;
  } else {
    const s = await getSettings();
    body = <IntegrationsPanel storageConfigured={storageConfigured()} slack={{ webhook: s.slackWebhook ?? "", events: s.slackEvents ?? {} }} slackEvents={{ ...SLACK_EVENTS }} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" subtitle="Design types, the working week, holidays, the team's hours and leave." />
      <nav className="ds-tabs self-start" aria-label="Settings sections">
        {tabs.map((t) => (
          <Link key={t.key} href={`/design/admin/settings?tab=${t.key}`} className="ds-tab" aria-current={tab === t.key ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
