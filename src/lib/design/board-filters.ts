import type { TicketCard } from "./tickets";
import { OPEN_STATUSES, addDays, dueHealth, istDate, istMoment, weekdayOf } from "./rules";

/**
 * The board's quick filters, the same rules as the dashboard's four numbers (whose cards open the board with ?filter=): open tickets,
 * overdue ones, those in review, and those delivered since Monday (IST).
 */
export const BOARD_FILTERS = {
  all: { label: "All", test: () => true },
  active: { label: "Open", test: (t: TicketCard) => OPEN_STATUSES.includes(t.status) },
  overdue: { label: "Overdue", test: (t: TicketCard) => OPEN_STATUSES.includes(t.status) && dueHealth(t.dueAt, t.status) === "overdue" },
  in_review: { label: "In review", test: (t: TicketCard) => t.status === "in_review" },
  delivered: { label: "Delivered this week", test: (t: TicketCard) => !!t.deliveredAt && +new Date(t.deliveredAt) >= +istMoment(addDays(istDate(), -weekdayOf(istDate()))) },
} as const;
export type BoardFilter = keyof typeof BOARD_FILTERS;
