/**
 * The HR Daily Report (/attendance/admin/daily-report): one day, everyone who checked in. Pure: the rows' shape, the status words and the
 * CSV; reports.ts reads the day (dailyReport).
 */

import { formatDistance, type PlaceTag } from "./checkin-rules";
import { istClock } from "./time";

export type DailyRow = {
  userId: string;
  name: string;
  email: string;
  checkIn: string;
  checkOut: string | null;
  place: PlaceTag | null;
  area: string | null;
  distanceM: number | null;
  hoursWorked: number | null;
  /** Today, not checked out yet: hours since check-in so far. */
  hoursSoFar: number | null;
  isLate: boolean;
  isEarlyOut: boolean;
  isWfh: boolean;
  regularized: boolean;
};

/** Present / Late / Early Out (both when both: "Late · Early Out"). */
export const dailyStatus = (r: Pick<DailyRow, "isLate" | "isEarlyOut">) => [r.isLate && "Late", r.isEarlyOut && "Early Out"].filter(Boolean).join(" · ") || "Present";

export const dailyRows = (rows: DailyRow[]): unknown[][] => [
  ["Name", "Email", "Check In", "Check Out", "Location", "Distance from Office", "Hours Worked", "Status", "Late"],
  ...rows.map((r) => [
    r.name,
    r.email,
    istClock(r.checkIn),
    r.checkOut ? istClock(r.checkOut) : "",
    r.place === "in_office" ? "In Office" : r.place === "remote" ? `Remote${r.area ? ` · ${r.area}` : ""}` : "",
    r.distanceM != null ? formatDistance(r.distanceM) : "",
    r.hoursWorked ?? "",
    dailyStatus(r),
    r.isLate ? "Yes" : "No",
  ]),
];

const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "2026-11-25" → "daily-report-25-nov-2026.csv". */
export const dailyFileName = (day: string) => `daily-report-${Number(day.slice(8))}-${MONTH_ABBR[Number(day.slice(5, 7)) - 1]}-${day.slice(0, 4)}.csv`;

