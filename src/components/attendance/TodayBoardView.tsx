import type { TodayBoard, TodayPerson } from "@/lib/attendance/overview";
import { Avatar, Badge, Card } from "./ui";

/** Who is where today: in office, WFH, on leave, not in yet (Home → Team, and HR's Today). */
export function TodayBoardView({ board, showOff = true }: { board: TodayBoard; showOff?: boolean }) {
  const groups: { key: keyof Omit<TodayBoard, "day">; title: string; tone: "green" | "teal" | "blue" | "red" | "grey"; empty: string }[] = [
    { key: "inOffice", title: "In office", tone: "green", empty: "Nobody has checked in at the office yet." },
    { key: "wfh", title: "Working from home", tone: "teal", empty: "Nobody is working from home today." },
    { key: "onLeave", title: "On leave", tone: "blue", empty: "Nobody is on leave today." },
    { key: "notIn", title: "Not checked in yet", tone: "red", empty: "Everyone expected has checked in." },
  ];
  if (showOff && board.off.length) groups.push({ key: "off", title: "Off today", tone: "grey", empty: "" });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => {
        const people = board[g.key] as TodayPerson[];
        return (
          <Card
            key={g.key}
            pad={false}
            title={
              <span className="flex items-center gap-2">
                {g.title} <Badge tone={g.tone}>{people.length}</Badge>
              </span>
            }
          >
            {people.length === 0 ? (
              <p className="px-5 py-4 text-sm att-muted">{g.empty}</p>
            ) : (
              <ul className="max-h-80 divide-y divide-[var(--att-line)] overflow-y-auto">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                    <Avatar name={p.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                      <p className="truncate text-xs att-muted">{[p.designation, p.teamName, p.branchName].filter(Boolean).join(" · ") || "—"}</p>
                    </div>
                    <div className="text-right text-xs">
                      {p.checkIn && (
                        <p className="font-semibold tabular-nums text-ink">
                          {p.checkIn}
                          {p.checkOut ? ` – ${p.checkOut}` : ""}
                        </p>
                      )}
                      {p.late && <Badge tone="amber">Late</Badge>}
                      {p.note && <p className="att-muted">{p.note}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
