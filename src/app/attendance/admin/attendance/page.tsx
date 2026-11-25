import { Download } from "lucide-react";
import { Card, DayBadge, Empty, PageHeader } from "@/components/attendance/ui";
import { requireAdmin } from "@/lib/attendance/dal";
import { listMembers } from "@/lib/attendance/host-adapter";
import { personDays, recordOf } from "@/lib/attendance/days";
import { tally } from "@/lib/attendance/summary";
import { isUuid } from "@/lib/attendance/att.manifest";
import { addDays, daysBetween, formatDayShort, formatHours, isDay, istClock, istDay } from "@/lib/attendance/time";
import { formatDistance, placeOfPunch, type PlaceTag } from "@/lib/attendance/checkin-rules";

export const metadata = { title: "Attendance · Attendance Admin" };

const METHOD: Record<string, string> = { ip: "office network", gps: "GPS", wfh: "WFH", manual: "Regularized" };

/** One punch's location: In Office / Remote (orange), how it was known, the distance from the office, the coordinates (map link), the area. */
function PunchPlace({ label, place, method, lat, lng, distanceM, accuracyM, area }: { label: string; place: PlaceTag | null; method: string | null; lat: number | null; lng: number | null; distanceM: number | null; accuracyM: number | null; area: string | null }) {
  if (!place && !method) return null;
  return (
    <div className={place === "remote" ? "att-text-remote" : undefined} data-testid="punch-place">
      <span className="font-semibold">
        {label}: {place === "in_office" ? "In Office" : place === "remote" ? "Remote" : METHOD[method ?? ""] ?? "—"}
      </span>
      {place && method && <span className="att-muted"> ({METHOD[method] ?? method})</span>}
      {distanceM != null && <span> · {formatDistance(distanceM)} from office</span>}
      {area && <span> · {area}</span>}
      {lat != null && lng != null && (
        <span className="block tabular-nums att-muted">
          {lat.toFixed(6)}, {lng.toFixed(6)}
          {accuracyM != null ? ` ±${Math.round(accuracyM)} m` : ""}{" "}
          <a className="text-[var(--att-primary)]" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`} target="_blank" rel="noreferrer">
            map
          </a>
        </span>
      )}
    </div>
  );
}

/** Anyone's days over a date range: status, in/out times, where each punch was made (remote ones in orange), hours and marks. */
export default async function AdminAttendancePage({ searchParams }: PageProps<"/attendance/admin/attendance">) {
  await requireAdmin();
  const sp = await searchParams;
  const today = istDay();
  const members = await listMembers();
  const userId = isUuid(sp.user) && members.some((m) => m.id === sp.user) ? sp.user : (members[0]?.id ?? null);
  let to = isDay(sp.to) ? sp.to : today;
  let from = isDay(sp.from) ? sp.from : addDays(today, -30);
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > 366) from = addDays(to, -366);
  const data = userId ? await personDays(userId, from, to) : null;
  const t = data ? tally(data.views) : null;
  return (
    <>
      <PageHeader title="Attendance" subtitle="Look up anyone's attendance over a date range." />
      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
            Person
            <select name="user" defaultValue={userId ?? ""} className="input">
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
            From
            <input type="date" name="from" defaultValue={from} className="input" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
            To
            <input type="date" name="to" defaultValue={to} className="input" />
          </label>
          <button type="submit" className="btn btn-primary">
            Show
          </button>
        </form>
      </Card>
      {!data || !userId ? (
        <Card>
          <Empty title="Nobody to show">Give people the Attendance application first.</Empty>
        </Card>
      ) : (
        <Card
          title={t ? `Present ${t.present} · WFH ${t.wfh} · Leave ${t.leave} · Absent ${t.absent} · Late ${t.late} · Early out ${t.earlyOut} · ${formatHours(t.hours)} · In office ${t.inOffice} · Remote ${t.remote}` : undefined}
          actions={
            <a href={`/api/attendance/export?report=person&user=${userId}&from=${from}&to=${to}`} className="btn btn-ghost btn-sm">
              <Download size={14} aria-hidden /> CSV
            </a>
          }
          pad={false}
        >
          <div className="att-scroll">
            <table className="att-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Location</th>
                  <th>Hours</th>
                  <th>Marks</th>
                </tr>
              </thead>
              <tbody>
                {[...data.views]
                  .reverse()
                  .filter((v) => v.status !== "upcoming")
                  .map((v) => {
                    const r = recordOf(data.data, userId, v.day);
                    return (
                      <tr key={v.day}>
                        <td className="whitespace-nowrap font-semibold">{formatDayShort(v.day)}</td>
                        <td>
                          <DayBadge view={v} />
                        </td>
                        <td className="tabular-nums">{r?.checkInTime ? istClock(r.checkInTime) : "—"}</td>
                        <td className="tabular-nums">{r?.checkOutTime ? istClock(r.checkOutTime) : "—"}</td>
                        <td className={`min-w-56 space-y-1 text-xs ${placeOfPunch(r?.checkInPlace, r?.checkInMethod) === "remote" || placeOfPunch(r?.checkOutPlace, r?.checkOutMethod) === "remote" ? "att-remote-cell" : ""}`}>
                          {r && (
                            <>
                              <PunchPlace label="In" place={placeOfPunch(r.checkInPlace, r.checkInMethod)} method={r.checkInMethod} lat={r.checkInLat} lng={r.checkInLng} distanceM={r.checkInDistanceM} accuracyM={r.checkInAccuracyM} area={r.checkInArea} />
                              <PunchPlace label="Out" place={placeOfPunch(r.checkOutPlace, r.checkOutMethod)} method={r.checkOutMethod} lat={r.checkOutLat} lng={r.checkOutLng} distanceM={r.checkOutDistanceM} accuracyM={r.checkOutAccuracyM} area={r.checkOutArea} />
                            </>
                          )}
                          {!r && "—"}
                        </td>
                        <td className="tabular-nums">{r?.hoursWorked != null ? formatHours(Number(r.hoursWorked)) : "—"}</td>
                        <td className="text-xs">
                          {[r?.isLate && "Late", r?.isEarlyOut && "Early out", r?.isExtraWork && "Extra work", r?.regularizationId && "Regularized", v.leave && v.leave.typeName, v.holidayName].filter(Boolean).join(" · ")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
