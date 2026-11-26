/**
 * Annual Maintenance Contracts, the parts the screen, the server and the unit tests share: the contract types, financial years, and totals.
 * No server-only imports. Amounts are integer paise, like all money in the Inventory module.
 */

/** The order of the form's dropdown. (The branch page groups in AMC_GROUP_ORDER.) */
export const AMC_TYPES = ["comprehensive", "non_comprehensive", "service", "cec", "labour"] as const;
export type AmcType = (typeof AMC_TYPES)[number];

export const AMC_TYPE_LABEL: Record<AmcType, string> = {
  comprehensive: "Comprehensive",
  non_comprehensive: "Non-Comprehensive",
  service: "Service",
  cec: "CEC",
  labour: "Labour",
};
/** What the shorter names mean, for the form's dropdown and a tooltip. */
export const AMC_TYPE_HINT: Record<AmcType, string> = {
  comprehensive: "Comprehensive",
  non_comprehensive: "Non-Comprehensive",
  service: "Service",
  cec: "CEC (Compressor Excluded Contract)",
  labour: "Labour",
};

/** The order a branch's contracts are grouped in on its page. */
export const AMC_GROUP_ORDER: readonly AmcType[] = ["non_comprehensive", "comprehensive", "service", "cec", "labour"];

/** 2025 → "2025-26": the financial year that starts in April of that year. */
export const fyLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

/** The financial year (April to March, India time) a moment falls in, as the year it starts: 14 Nov 2026 → 2026, 3 Feb 2027 → 2026. */
export function fyStartOf(at: Date | number = Date.now()): number {
  const ist = new Date(+at + 330 * 60_000);
  const y = ist.getUTCFullYear();
  return ist.getUTCMonth() >= 3 ? y : y - 1;
}

/** A contract's pair of years: "2025-26 & 2026-27". */
export const fyPairLabel = (startYear: number) => `${fyLabel(startYear)} & ${fyLabel(startYear + 1)}`;

/** The years to offer on the form and the filter: every one in use, and the ones around the current financial year, newest first. */
export function fyChoices(inUse: readonly number[], now: Date | number = Date.now()): number[] {
  const cur = fyStartOf(now);
  return [...new Set([...inUse, cur - 1, cur, cur + 1])].sort((a, b) => b - a);
}

/** The year the page opens on: the one asked for if it is a real choice, else the newest one in use, else the current financial year. */
export function pickFy(asked: number | null, inUse: readonly number[], now: Date | number = Date.now()): number {
  if (asked != null && Number.isInteger(asked) && asked >= 2000 && asked <= 2100) return asked;
  return inUse.length ? Math.max(...inUse) : fyStartOf(now);
}

type Amounts = { amountCurrentFy: number | null; amountNextFy: number | null };

/** The sum of each year's amounts (a missing amount counts as nothing), in paise. */
export function amcTotals(rows: readonly Amounts[]): { current: number; next: number } {
  return rows.reduce((t, r) => ({ current: t.current + (r.amountCurrentFy ?? 0), next: t.next + (r.amountNextFy ?? 0) }), { current: 0, next: 0 });
}

/**
 * A branch's contracts grouped by type, in AMC_GROUP_ORDER, each with its own totals. A type with no contracts has no group. Within a group
 * the rows keep the order they came in.
 */
export function groupAmc<T extends Amounts & { amcType: AmcType }>(rows: readonly T[]): { type: AmcType; rows: T[]; totals: { current: number; next: number } }[] {
  return AMC_GROUP_ORDER.map((type) => {
    const mine = rows.filter((r) => r.amcType === type);
    return { type, rows: mine, totals: amcTotals(mine) };
  }).filter((g) => g.rows.length > 0);
}

/**
 * What a contract costs in one particular financial year (given as its start year), or null when it does not cover that year: a contract
 * kept for 2025 and 2026 has its first amount in 2025 and its second in 2026.
 */
export function amountInFy(r: Amounts & { fyStartYear: number }, fy: number): number | null {
  if (r.fyStartYear === fy) return r.amountCurrentFy;
  if (r.fyStartYear === fy - 1) return r.amountNextFy;
  return null;
}
