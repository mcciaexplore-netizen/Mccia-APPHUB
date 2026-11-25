"use client";

import { useMemo, useState } from "react";
import type { DailyRow } from "@/lib/attendance/daily";
import { formatDistance } from "@/lib/attendance/checkin-rules";
import { formatHours, istClock } from "@/lib/attendance/time";
import { Avatar, Badge, Card, Empty, PlaceBadge } from "../ui";

type Filter = "all" | "in_office" | "remote" | "late";
type Sort = "name" | "checkIn" | "location";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_office", label: "In Office" },
  { key: "remote", label: "Remote" },
  { key: "late", label: "Late" },
];

// In office first, then remote (nearest first), then no place (regularized); by name within each.
const placeRank = (r: DailyRow) => (r.place === "in_office" ? 0 : r.place === "remote" ? 1 : 2);

/**
 * The Daily Report's table: everyone who checked in that day, searchable by name, filtered (All / In Office / Remote / Late) and sorted (Name,
 * Check In time, Location). Someone still in today shows the hours so far.
 */
export function DailyReportView({ rows }: { rows: DailyRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) => (!needle || r.name.toLowerCase().includes(needle)) && (filter === "all" || (filter === "late" ? r.isLate : r.place === filter)),
    );
    const byName = (a: DailyRow, b: DailyRow) => a.name.localeCompare(b.name);
    return list.sort((a, b) =>
      sort === "checkIn"
        ? a.checkIn.localeCompare(b.checkIn) || byName(a, b)
        : sort === "location"
          ? placeRank(a) - placeRank(b) || (a.distanceM ?? 0) - (b.distanceM ?? 0) || byName(a, b)
          : byName(a, b),
    );
  }, [rows, q, filter, sort]);

  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--att-line)] px-4 py-3">
        <input className="input w-full sm:max-w-xs" type="search" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by name" />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" className={`btn btn-sm ${filter === f.key ? "btn-primary" : "btn-ghost"}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs font-semibold att-muted">
          Sort by
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
            <option value="name">Name</option>
            <option value="checkIn">Check In time</option>
            <option value="location">Location</option>
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <Empty title="Nobody checked in">No one checked in on this day.</Empty>
      ) : shown.length === 0 ? (
        <Empty title="No matches">Nobody matches the search or filter.</Empty>
      ) : (
        <div className="att-scroll">
          <table className="att-table" data-testid="daily-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Location</th>
                <th>Hours Worked</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.userId}>
                  <td>
                    <span className="flex items-center gap-2">
                      <Avatar name={r.name} size={28} />
                      <span className="font-semibold text-ink">{r.name}</span>
                    </span>
                  </td>
                  <td className="tabular-nums">{istClock(r.checkIn)}</td>
                  <td className="tabular-nums">{r.checkOut ? istClock(r.checkOut) : "—"}</td>
                  <td>
                    {r.place ? (
                      <span title={r.distanceM != null ? `${formatDistance(r.distanceM)} from the office` : undefined}>
                        <PlaceBadge place={r.place} area={r.area} distanceM={r.area ? null : r.distanceM} />
                      </span>
                    ) : (
                      <span className="text-xs att-muted">{r.regularized ? "Regularized" : "—"}</span>
                    )}
                  </td>
                  <td className="tabular-nums">
                    {r.hoursWorked != null ? (
                      formatHours(r.hoursWorked)
                    ) : r.hoursSoFar != null ? (
                      <span className="att-muted">{formatHours(r.hoursSoFar)} so far</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {!r.isLate && !r.isEarlyOut && <Badge tone="green">Present</Badge>}
                      {r.isLate && <Badge tone="amber">Late</Badge>}
                      {r.isEarlyOut && <Badge tone="amber">Early Out</Badge>}
                      {r.isWfh && <Badge tone="teal">WFH</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-3 text-xs att-muted">
        {shown.length} of {rows.length} shown. Only people who checked in this day are listed.
      </p>
    </Card>
  );
}
